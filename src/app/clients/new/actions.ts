"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { prisma } from "@/lib/prisma";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { findClientByDomain, normalizeDomainKey } from "@/lib/clients";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return false;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  return Boolean(u);
}

export type CheckClientDomainResult =
  | { ok: true; duplicate: { slug: string; name: string; domain: string } | null }
  | { ok: false; error: string };

// Pre-flight duplicate check. Scans the tenant's Neon Client rows and
// returns the first record whose stored domain collapses to the same
// key as the user's input. The caller renders the inline red flag and
// deep-links to the existing client via the returned slug (legacyRfId
// stringified for RF-imported rows, cuid for Ace-native).
export async function checkClientDomain(domainRaw: string): Promise<CheckClientDomainResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const needle = normalizeDomainKey(domainRaw);
  if (!needle) return { ok: true, duplicate: null };
  try {
    const hit = await findClientByDomain(domainRaw);
    if (hit) {
      return {
        ok: true,
        duplicate: { slug: hit.slug, name: hit.name, domain: hit.domain },
      };
    }
    return { ok: true, duplicate: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't check for duplicate clients." };
  }
}

export type CreateClientPayload = {
  name: string;
  website: string;
  industry: string;
  phone: string;
  city: string;
  state: string;
  linkedin: string;
  overview: string;
  primaryContact: {
    firstName: string;
    lastName: string;
    title: string;
    email: string;
    phone: string;
  };
};

export type CreateClientResult = Result<{ slug: string; clientCuid: string; primaryContactId: string | null }>;

// Ace-native create path. Writes a new Client row to Neon with the
// current tenant's organizationId stamped. No RecruiterFlow call. If
// the user supplied a primary contact, a Contact row is created in
// the same transaction and linked via clientId (cuid FK).
export async function createClient(payload: CreateClientPayload): Promise<CreateClientResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const name = payload.name.trim();
  if (!name) return { ok: false, error: "Company name is required." };

  try {
    const org = await getCurrentOrg();
    const ownerId = await getCurrentUserId();
    const domainRaw = payload.website.trim();
    const domain = domainRaw ? domainRaw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : null;

    // Hard duplicate-domain guard on the server too. The client-side
    // pre-flight gates the Save button, but another tab can create the
    // same domain between blur and submit.
    if (domain) {
      const dup = await findClientByDomain(domain);
      if (dup) {
        return { ok: false, error: `A client with this domain already exists (${dup.name}).` };
      }
    }

    const city = payload.city.trim();
    const state = payload.state.trim();
    const locationJson: Record<string, string> | undefined =
      city || state
        ? {
            ...(city ? { city } : {}),
            ...(state ? { state } : {}),
          }
        : undefined;
    const phone = payload.phone.trim();

    const pc = payload.primaryContact;
    const hasContact = (pc.firstName + pc.lastName + pc.email + pc.phone).trim().length > 0;

    // Brand mark via Clearbit's free logo CDN. The URL is constructed
    // from the bare domain — Clearbit returns a 404 PNG when there's
    // no logo on file, which the client-side <ClientLogo> component
    // catches and replaces with an initials chip. No HEAD probe here:
    // a broken-image fallback is cheaper than a synchronous round-trip
    // on the create path.
    const logoUrl = domain ? `https://logo.clearbit.com/${domain}` : null;

    const client = await prisma.client.create({
      data: {
        name,
        domain,
        logoUrl,
        industry: payload.industry.trim() || null,
        linkedinPage: payload.linkedin.trim() || null,
        overview: payload.overview.trim() || null,
        location: locationJson,
        phoneNumbers: phone ? [{ number: phone }] : [],
        organizationId: org.id,
        ownerId,
        addedAt: new Date(),
      },
      select: { id: true, legacyRfId: true },
    });

    let primaryContactId: string | null = null;
    if (hasContact) {
      const first = pc.firstName.trim() || "Contact";
      const last = pc.lastName.trim() || "";
      const contact = await prisma.contact.create({
        data: {
          firstName: first,
          lastName: last || null,
          name: [first, last].filter(Boolean).join(" "),
          emails: pc.email.trim() ? [pc.email.trim()] : [],
          phoneNumbers: pc.phone.trim() ? [{ number: pc.phone.trim() }] : undefined,
          currentDesignation: pc.title.trim() || null,
          clientId: client.id,
          organizationId: org.id,
          addedAt: new Date(),
        },
        select: { id: true },
      });
      primaryContactId = contact.id;
    }

    const slug = client.legacyRfId != null ? String(client.legacyRfId) : client.id;
    revalidatePath("/clients");
    revalidatePath(`/clients/${slug}`);
    return { ok: true, value: { slug, clientCuid: client.id, primaryContactId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create client." };
  }
}

// ---- Website auto-parse ----
//
// User pastes a URL; we fetch the homepage HTML, strip to text, and ask
// Claude to extract structured company fields. AUTO per the project rule
// — structured extraction, no hand-written content. The client-side form
// debounces the paste so we don't hammer arbitrary URLs on every keystroke.

export type WebsiteParseFields = {
  name: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  linkedin: string | null;
  overview: string | null;
};

export type ParseWebsiteResult = Result<{ fields: WebsiteParseFields }>;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 400_000;

export async function parseClientWebsite(url: string): Promise<ParseWebsiteResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };

  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "URL is required." };
  const normalizedUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;

  let html = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AceBot/1.0; +https://ace.breakpointtalent.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `Couldn't fetch ${normalizedUrl} (${res.status}).` };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      html = (await res.text()).slice(0, MAX_HTML_BYTES);
    } else {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_HTML_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        total += value.byteLength;
      }
      html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed." };
  }

  const textish = stripHtmlToText(html).slice(0, 30_000);
  if (!textish.trim()) {
    return { ok: false, error: "The page had no readable text." };
  }

  try {
    const fields = await extractFieldsFromHomepage(normalizedUrl, textish);
    return { ok: true, value: { fields } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claude extraction failed." };
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractFieldsFromHomepage(url: string, pageText: string): Promise<WebsiteParseFields> {
  const anthropic = getClaude();
  const org = await getCurrentOrg();
  const trainerBlock = await buildPersonalTrainerBlock(org.id);
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ],
    system:
      "You extract company fields from a website homepage for a recruiting CRM. " +
      "You return strict JSON only." +
      trainerBlock,
    messages: [
      {
        role: "user",
        content:
          `Website URL: ${url}\n\n` +
          `--- Homepage text (stripped HTML) ---\n${pageText}\n\n` +
          "Return ONLY a JSON object, no prose, no code fences:\n" +
          "{\n" +
          '  "name": string|null,        // official company name\n' +
          '  "industry": string|null,    // one short phrase — "Software", "Healthcare", "Financial Services"\n' +
          '  "city": string|null,        // HQ city if present\n' +
          '  "state": string|null,       // US state abbreviation (e.g. "OH"), else country\n' +
          '  "phone": string|null,       // a contact phone if listed\n' +
          '  "linkedin": string|null,    // full LinkedIn URL if linked\n' +
          '  "overview": string|null     // 1-2 sentence description of what the company does\n' +
          "}\n\n" +
          "Rules:\n" +
          "- Use null for fields that aren't clearly on the homepage. Don't guess.\n" +
          "- 'phone' is digits+formatting as it appears — don't reformat.\n" +
          "- 'industry' is ONE phrase, not a list.\n" +
          "- 'overview' is the recruiter-facing summary: what they do, who they serve.",
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = safeParseJson(text);
  return {
    name: strOrNull(parsed?.name),
    industry: strOrNull(parsed?.industry),
    city: strOrNull(parsed?.city),
    state: strOrNull(parsed?.state),
    phone: strOrNull(parsed?.phone),
    linkedin: strOrNull(parsed?.linkedin),
    overview: strOrNull(parsed?.overview),
  };
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return tryParse(match[0]);
}

function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
