import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";
// Page fetch + Claude round-trip can run long on slow job boards. 60s
// matches the other Claude-backed routes in this codebase.
export const maxDuration = 60;

// Parse a recruiter-pasted source URL into a clean text dump the JD
// Generate flow can consume. When called from an existing Job's JD tab
// (jobId set), the URL is also persisted onto Job.sourceJobUrl so a
// failed parse doesn't lose the link. When called from /jobs/new
// (jobId absent — the Job row doesn't exist yet), the URL save is
// skipped and the route is pure parse.

type ParseUrlRequest = { jobId?: string | null; url: string };
type ParseUrlResponse =
  | { ok: true; extracted: string; urlSaved: boolean }
  | { ok: false; error: string; urlSaved: boolean };

export async function POST(req: NextRequest): Promise<NextResponse<ParseUrlResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in.", urlSaved: false }, { status: 401 });
  }

  let body: ParseUrlRequest;
  try {
    body = (await req.json()) as ParseUrlRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body.", urlSaved: false }, { status: 400 });
  }

  const jobId = (body.jobId ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { ok: false, error: "URL must start with http:// or https://.", urlSaved: false },
      { status: 400 },
    );
  }
  if (url.length > 2000) {
    return NextResponse.json({ ok: false, error: "URL too long.", urlSaved: false }, { status: 400 });
  }

  // Persist the URL when we have an existing Job row. /jobs/new posts
  // without a jobId because the Job hasn't been created yet — the URL
  // sticks to Job.sourceJobUrl later via createJob if we wire it through.
  let urlSaved = false;
  if (jobId) {
    try {
      const org = await getCurrentOrg();
      const job = await prisma.job.findFirst({
        where: { id: jobId, organizationId: org.id },
        select: { id: true },
      });
      if (!job) {
        return NextResponse.json({ ok: false, error: "Job not found.", urlSaved: false }, { status: 404 });
      }
      await prisma.job.update({ where: { id: job.id }, data: { sourceJobUrl: url } });
      urlSaved = true;
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Couldn't save URL.", urlSaved: false },
        { status: 500 },
      );
    }
  }

  // Fetch the page. Many job boards return 403 to bare-metal fetches,
  // so spoof a desktop UA. AbortController bounds the fetch so a hung
  // server doesn't tie up the whole serverless invocation.
  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Couldn't fetch the page (HTTP ${res.status}).`, urlSaved },
        { status: 200 },
      );
    }
    html = await res.text();
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Fetch timed out after 20 seconds."
        : e instanceof Error
          ? e.message
          : "Couldn't fetch the page.";
    return NextResponse.json({ ok: false, error: msg, urlSaved }, { status: 200 });
  }

  // Strip scripts/styles + collapse tags to give Claude a smaller, cheaper
  // body. Cap the slice at 80k chars — same budget the resume parser uses.
  const stripped = stripHtmlForClaude(html).slice(0, 80_000);
  if (!stripped.trim()) {
    return NextResponse.json(
      { ok: false, error: "The page returned no readable text.", urlSaved },
      { status: 200 },
    );
  }

  let extracted: string;
  try {
    extracted = await extractJobFieldsAsPlain(stripped);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Claude couldn't parse the page.", urlSaved },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, extracted, urlSaved });
}

function stripHtmlForClaude(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ExtractedJob = {
  title: string | null;
  location: string | null;
  salary: string | null;
  employment_type: string | null;
  company_info: string | null;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  skills: string[];
};

async function extractJobFieldsAsPlain(pageText: string): Promise<string> {
  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system:
      "You extract structured job fields from raw job-board HTML for a recruiting CRM. " +
      "Return STRICT JSON only — no prose, no markdown fences. Never invent fields; if missing, return null or [].",
    messages: [
      {
        role: "user",
        content:
          "Extract these fields from the job posting below. Return ONLY a JSON object with this exact shape:\n" +
          "{\n" +
          '  "title": string|null,\n' +
          '  "location": string|null,\n' +
          '  "salary": string|null,\n' +
          '  "employment_type": string|null,\n' +
          '  "company_info": string|null,\n' +
          '  "responsibilities": string[],\n' +
          '  "requirements": string[],\n' +
          '  "benefits": string[],\n' +
          '  "skills": string[]\n' +
          "}\n\n" +
          "Rules:\n" +
          "- Use null for any single-string field not present. Use [] for missing list fields.\n" +
          "- 'salary' is the comp range or single number, including currency and period if shown.\n" +
          "- 'employment_type' is e.g. 'Full-time', 'Contract', 'Part-time'.\n" +
          "- 'company_info' is a short factual blurb about the hiring company (industry, size, mission).\n" +
          "- List items are short factual phrases pulled from the source — no paraphrasing flourishes.\n" +
          "- Drop boilerplate like 'apply now', 'EEO statements', cookie notices.\n" +
          "- If the page is not actually a job posting, return all nulls / empty arrays.\n\n" +
          "=== Page text ===\n" +
          pageText,
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = safeJsonParse<ExtractedJob>(raw);
  if (!parsed) {
    throw new Error("Claude returned a non-JSON response. Try Parse Link again or paste the JD manually.");
  }

  return formatExtractedAsPlain(parsed);
}

function formatExtractedAsPlain(p: ExtractedJob): string {
  const parts: string[] = [];
  if (p.title) parts.push(`Title: ${p.title}`);
  if (p.location) parts.push(`Location: ${p.location}`);
  if (p.salary) parts.push(`Salary: ${p.salary}`);
  if (p.employment_type) parts.push(`Employment Type: ${p.employment_type}`);
  if (p.company_info) parts.push(`\nAbout the Company:\n${p.company_info}`);
  if (Array.isArray(p.responsibilities) && p.responsibilities.length > 0) {
    parts.push(`\nResponsibilities:\n${p.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }
  if (Array.isArray(p.requirements) && p.requirements.length > 0) {
    parts.push(`\nRequirements:\n${p.requirements.map((r) => `- ${r}`).join("\n")}`);
  }
  if (Array.isArray(p.benefits) && p.benefits.length > 0) {
    parts.push(`\nBenefits:\n${p.benefits.map((b) => `- ${b}`).join("\n")}`);
  }
  if (Array.isArray(p.skills) && p.skills.length > 0) {
    parts.push(`\nSkills: ${p.skills.join(", ")}`);
  }
  return parts.join("\n").trim();
}

function safeJsonParse<T>(raw: string): T | null {
  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return tryParse(m[0]);
}
