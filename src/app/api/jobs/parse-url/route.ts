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
type ParseUrlErrorCode =
  | "auth_required"
  | "bad_request"
  | "indeed_blocked"
  | "linkedin_blocked"
  | "fetch_failed"
  | "parse_failed";
type ParsedFields = {
  title?: string;
  location?: string;
  // Structured location parts so the /jobs/new form can fill the City /
  // State / Zip inputs separately for downstream search filtering. The
  // legacy `location` string stays populated for callers that still
  // render free-form location text.
  city?: string;
  state?: string;
  zip?: string;
  salaryLow?: number;
  salaryHigh?: number;
};
type ParseUrlResponse =
  | { ok: true; extracted: string; fields: ParsedFields; urlSaved: boolean }
  | { ok: false; error: ParseUrlErrorCode; message: string; urlSaved: boolean };

export async function POST(req: NextRequest): Promise<NextResponse<ParseUrlResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "auth_required", message: "Not signed in.", urlSaved: false },
      { status: 401 },
    );
  }

  let body: ParseUrlRequest;
  try {
    body = (await req.json()) as ParseUrlRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "Invalid JSON body.", urlSaved: false },
      { status: 400 },
    );
  }

  const jobId = (body.jobId ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "URL must start with http:// or https://.", urlSaved: false },
      { status: 400 },
    );
  }
  if (url.length > 2000) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "URL too long.", urlSaved: false },
      { status: 400 },
    );
  }

  // Persist the URL when we have an existing Job row. /jobs/new posts
  // without a jobId because the Job hasn't been created yet — the URL
  // sticks to Job.sourceJobUrl via createJob's sourceJobUrl input.
  let urlSaved = false;
  if (jobId) {
    try {
      const org = await getCurrentOrg();
      const job = await prisma.job.findFirst({
        where: { id: jobId, organizationId: org.id },
        select: { id: true },
      });
      if (!job) {
        return NextResponse.json(
          { ok: false, error: "bad_request", message: "Job not found.", urlSaved: false },
          { status: 404 },
        );
      }
      await prisma.job.update({ where: { id: job.id }, data: { sourceJobUrl: url } });
      urlSaved = true;
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: "fetch_failed",
          message: e instanceof Error ? e.message : "Couldn't save URL.",
          urlSaved: false,
        },
        { status: 500 },
      );
    }
  }

  // BambooHR career pages are JavaScript shells. Their public detail
  // endpoint carries the actual title, location, compensation, and JD.
  const bambooHrDetailUrl = getBambooHrDetailUrl(url);
  const fetchUrl = bambooHrDetailUrl ?? url;

  // Fetch the page. Many job boards return 403 to bare-metal fetches,
  // so spoof a desktop UA. AbortController bounds the fetch so a hung
  // server doesn't tie up the whole serverless invocation.
  let pageText: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(fetchUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: bambooHrDetailUrl
          ? "application/json"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      const { code, message } = classifyFetchError(url, res.status);
      return NextResponse.json({ ok: false, error: code, message, urlSaved }, { status: 200 });
    }
    pageText = bambooHrDetailUrl
      ? formatBambooHrDetail(await res.json())
      : stripHtmlForClaude(await res.text());
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Fetch timed out after 20 seconds."
        : e instanceof Error
          ? e.message
          : "Couldn't fetch the page.";
    return NextResponse.json(
      { ok: false, error: "fetch_failed", message: msg, urlSaved },
      { status: 200 },
    );
  }

  // Cap the text at 80k chars — same budget the resume parser uses.
  const stripped = pageText.slice(0, 80_000);
  if (!stripped.trim()) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed", message: "The page returned no readable text.", urlSaved },
      { status: 200 },
    );
  }

  let extracted: string;
  let fields: ParsedFields;
  try {
    const parsed = await extractJobFields(stripped);
    extracted = parsed.extracted;
    fields = parsed.fields;
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "parse_failed",
        message: e instanceof Error ? e.message : "Claude couldn't parse the page.",
        urlSaved,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, extracted, fields, urlSaved });
}

function getBambooHrDetailUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/(^|\.)bamboohr\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/careers\/(\d+)(?:\/detail)?\/?$/i);
    if (!match) return null;
    return `${parsed.origin}/careers/${match[1]}/detail`;
  } catch {
    return null;
  }
}

type BambooHrDetailPayload = {
  result?: {
    jobOpening?: {
      jobOpeningName?: unknown;
      departmentLabel?: unknown;
      employmentStatusLabel?: unknown;
      location?: {
        city?: unknown;
        state?: unknown;
        postalCode?: unknown;
        addressCountry?: unknown;
      } | null;
      description?: unknown;
      compensation?: unknown;
      minimumExperience?: unknown;
      locationType?: unknown;
    };
  };
};

function bambooText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatBambooHrDetail(payload: unknown): string {
  const opening = (payload as BambooHrDetailPayload)?.result?.jobOpening;
  if (!opening) throw new Error("BambooHR returned no open job details.");

  const location = opening.location;
  const locationText = [
    bambooText(location?.city),
    bambooText(location?.state),
    bambooText(location?.postalCode),
    bambooText(location?.addressCountry),
  ].filter((value): value is string => Boolean(value)).join(", ");
  const locationType = String(opening.locationType ?? "");
  const workplace = locationType === "1" ? "Remote" : locationType === "2" ? "Hybrid" : "On-site";
  const description = stripHtmlForClaude(bambooText(opening.description) ?? "");
  const lines = [
    bambooText(opening.jobOpeningName) ? `Title: ${bambooText(opening.jobOpeningName)}` : null,
    locationText ? `Location: ${locationText}` : null,
    bambooText(opening.departmentLabel) ? `Department: ${bambooText(opening.departmentLabel)}` : null,
    bambooText(opening.employmentStatusLabel)
      ? `Employment Type: ${bambooText(opening.employmentStatusLabel)}`
      : null,
    `Workplace: ${workplace}`,
    bambooText(opening.compensation) ? `Compensation: ${bambooText(opening.compensation)}` : null,
    bambooText(opening.minimumExperience)
      ? `Minimum Experience: ${bambooText(opening.minimumExperience)}`
      : null,
    description ? `Job Description:\n${description}` : null,
  ].filter((value): value is string => Boolean(value));

  if (lines.length === 0) throw new Error("BambooHR returned no readable job details.");
  return lines.join("\n");
}

function classifyFetchError(url: string, status: number): { code: ParseUrlErrorCode; message: string } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const isIndeed = host.includes("indeed.");
  const isLinkedIn = host.includes("linkedin.");
  if (isIndeed) {
    return {
      code: "indeed_blocked",
      message:
        "Indeed blocks server-side fetches. Paste the job description text into the Description field below instead.",
    };
  }
  if (isLinkedIn) {
    return {
      code: "linkedin_blocked",
      message:
        "LinkedIn blocks server-side fetches. Paste the job description text into the Description field below instead.",
    };
  }
  return { code: "fetch_failed", message: `Couldn't fetch the page (HTTP ${status}).` };
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
  city: string | null;
  state: string | null;
  zip: string | null;
  salary: string | null;
  salary_low: number | null;
  salary_high: number | null;
  employment_type: string | null;
  company_info: string | null;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  skills: string[];
};

async function extractJobFields(pageText: string): Promise<{ extracted: string; fields: ParsedFields }> {
  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system:
      "You extract structured job fields from raw job-board HTML for a recruiting CRM. " +
      "Return STRICT JSON only. No prose, no markdown fences. Never invent fields; if missing, return null or [].",
    messages: [
      {
        role: "user",
        content:
          "Extract these fields from the job posting below. Return ONLY a JSON object with this exact shape:\n" +
          "{\n" +
          '  "title": string|null,\n' +
          '  "location": string|null,\n' +
          '  "city": string|null,\n' +
          '  "state": string|null,\n' +
          '  "zip": string|null,\n' +
          '  "salary": string|null,\n' +
          '  "salary_low": number|null,\n' +
          '  "salary_high": number|null,\n' +
          '  "employment_type": string|null,\n' +
          '  "company_info": string|null,\n' +
          '  "responsibilities": string[],\n' +
          '  "requirements": string[],\n' +
          '  "benefits": string[],\n' +
          '  "skills": string[]\n' +
          "}\n\n" +
          "Rules:\n" +
          "- Use null for any single-string or number field not present. Use [] for missing list fields.\n" +
          "- 'location' is the human-readable composed location (e.g. 'Florence, KY 41042').\n" +
          "- 'city' is just the city name (e.g. 'Florence'). 'state' is the 2-letter abbreviation if US (e.g. 'KY'), full state name otherwise. 'zip' is the 5-digit postal code if present. Prefer a specific city / state / zip over region descriptions like 'Cincinnati/Northern Kentucky'. If a commute requirement lists a specific city/zip, use that.\n" +
          "- 'salary' is the comp range or single number, including currency and period if shown.\n" +
          "- 'salary_low' and 'salary_high' are the numeric comp bounds parsed from the listing. For '$80,000-$120,000' return 80000 and 120000. For '$25-35/hr' return 25 and 35. If only one value is shown, set both to that value. If no comp info, both null. Never invent values.\n" +
          "- 'employment_type' is e.g. 'Full-time', 'Contract', 'Part-time'.\n" +
          "- 'company_info' is a short factual blurb about the hiring company (industry, size, mission).\n" +
          "- List items are short factual phrases pulled from the source. No paraphrasing flourishes.\n" +
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

  const fields: ParsedFields = {};
  if (parsed.title && parsed.title.trim()) fields.title = parsed.title.trim();
  if (parsed.location && parsed.location.trim()) fields.location = parsed.location.trim();
  if (parsed.city && parsed.city.trim()) fields.city = parsed.city.trim();
  if (parsed.state && parsed.state.trim()) fields.state = parsed.state.trim();
  if (parsed.zip && parsed.zip.trim()) fields.zip = parsed.zip.trim();
  if (typeof parsed.salary_low === "number" && Number.isFinite(parsed.salary_low) && parsed.salary_low >= 0) {
    fields.salaryLow = parsed.salary_low;
  }
  if (typeof parsed.salary_high === "number" && Number.isFinite(parsed.salary_high) && parsed.salary_high >= 0) {
    fields.salaryHigh = parsed.salary_high;
  }

  return { extracted: formatExtractedAsPlain(parsed), fields };
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
