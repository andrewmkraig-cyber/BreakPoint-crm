"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { recruiterflow } from "@/lib/recruiterflow";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return false;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  return Boolean(u);
}

// Normalize a user-typed or RF-stored domain down to a comparable key. Drops
// protocol, any path/querystring, a leading `www.`, and lowercases. Both sides
// of the duplicate check run through this so https://www.Acme.COM/about and
// acme.com collapse to the same string.
function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\/?#]/)[0] ?? "";
}

export type CheckClientDomainResult =
  | { ok: true; duplicate: { id: number; name: string; domain: string } | null }
  | { ok: false; error: string };

// Pre-flight duplicate check. Clients live in RecruiterFlow (no local Postgres
// Client table), so the source of truth is `listAllClients` — we normalize
// every stored domain and compare against the user's input. On RF failures we
// return ok:false and the caller treats it as "don't know" (lets save through
// and lets RF's own 403 surface as a save error, which is the pre-existing
// behavior).
export async function checkClientDomain(domainRaw: string): Promise<CheckClientDomainResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const needle = normalizeDomain(domainRaw);
  if (!needle) return { ok: true, duplicate: null };
  try {
    const clients = await recruiterflow.listAllClients({ perPage: 100 });
    for (const c of clients) {
      const hit = normalizeDomain(c.domain ?? null);
      if (hit && hit === needle) {
        return {
          ok: true,
          duplicate: {
            id: c.id,
            name: c.name ?? "(unnamed client)",
            domain: hit,
          },
        };
      }
    }
    return { ok: true, duplicate: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't check RecruiterFlow for duplicates." };
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

export type CreateClientResult = Result<{ id: number; primaryContactId: number | null }>;

export async function createClient(payload: CreateClientPayload): Promise<CreateClientResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const name = payload.name.trim();
  if (!name) return { ok: false, error: "Company name is required." };

  try {
    // Strip http(s):// for RF domain, which expects the bare hostname.
    const domainRaw = payload.website.trim();
    const domain = domainRaw ? domainRaw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : undefined;

    const locationParts: { city?: string; state?: string } = {};
    if (payload.city.trim()) locationParts.city = payload.city.trim();
    if (payload.state.trim()) locationParts.state = payload.state.trim();

    const created = await recruiterflow.createClient({
      name,
      domain: domain || undefined,
      industry: payload.industry.trim() || undefined,
      linkedin_page: payload.linkedin.trim() || undefined,
      phone_number: payload.phone.trim() || undefined,
      overview: payload.overview.trim() || undefined,
      location: Object.keys(locationParts).length > 0 ? locationParts : undefined,
    });

    const clientId =
      typeof created.id === "number"
        ? created.id
        : typeof (created as unknown as { client_company_id?: number }).client_company_id === "number"
          ? (created as unknown as { client_company_id: number }).client_company_id
          : null;

    if (!clientId) {
      return { ok: false, error: "RecruiterFlow didn't return a client id for the new company." };
    }

    let primaryContactId: number | null = null;
    const pc = payload.primaryContact;
    const hasContact = (pc.firstName + pc.lastName + pc.email + pc.phone).trim().length > 0;
    if (hasContact) {
      try {
        const contact = await recruiterflow.createContact({
          first_name: pc.firstName.trim() || "Contact",
          last_name: pc.lastName.trim() || undefined,
          email: pc.email.trim() || undefined,
          phone_number: pc.phone.trim() || undefined,
          current_designation: pc.title.trim() || undefined,
          client_company_id: clientId,
        });
        if (typeof contact?.id === "number") primaryContactId = contact.id;
      } catch (e) {
        // Non-fatal: client saved; contact failed. Surface in response so the
        // UI can warn the user but still navigate to the client detail page.
        // eslint-disable-next-line no-console
        console.warn("[createClient] primary contact create failed:", e instanceof Error ? e.message : e);
      }
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, value: { id: clientId, primaryContactId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create client." };
  }
}

// ---- Website auto-parse ----
//
// User pastes a URL into the form; we fetch the homepage HTML, strip to text,
// and ask Claude to extract structured company fields. AUTO per the project
// rule — structured extraction, no hand-written content. Caller debounces the
// paste so we don't hammer arbitrary URLs on every keystroke.

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
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system:
      "You extract company fields from a website homepage for a recruiting CRM. " +
      "You return strict JSON only. You never fabricate fields — if a value isn't clearly present, return null.",
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
