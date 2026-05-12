import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Server-side renderer for the Candidate Recruit outreach template.
// The composer calls this with a jobId once the recruiter picks a
// job from the in-composer job picker. We resolve every non-candidate
// merge field here (job title, location, company blurb, JD sections
// rendered as HTML <ul> lists) and hand back the final subject + body.
// Candidate fields stay as {{candidate.first_name}} placeholders so the
// composer's existing client-side resolver fills them from
// effectiveContext.

export type CandidateRecruitRequest = { jobId: string };

export type CandidateRecruitResponse = {
  ok: true;
  subject: string;
  bodyHtml: string;
  // The text-length we measured against the 1900-char limit. Useful for
  // logging / debugging from the composer.
  textLength: number;
  truncated: boolean;
};

export type CandidateRecruitErrorResponse = { ok: false; error: string };

const CHAR_LIMIT = 1900;
const TRUNCATION_PRIORITY = ["responsibilities", "requirements", "benefits"] as const;
type SectionKey = (typeof TRUNCATION_PRIORITY)[number];

export async function POST(
  req: NextRequest,
): Promise<NextResponse<CandidateRecruitResponse | CandidateRecruitErrorResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: CandidateRecruitRequest;
  try {
    body = (await req.json()) as CandidateRecruitRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });

  const org = await getCurrentOrg();
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    select: {
      id: true,
      title: true,
      description: true,
      locations: true,
      locationCity: true,
      locationState: true,
      client: { select: { name: true, industry: true } },
    },
  });
  if (!job) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });

  const jobTitle = (job.title ?? "").trim();
  const jobCity = resolveCity(job.locationCity, job.locations);
  const companyBlurb = buildCompanyBlurb(job.client?.industry ?? null);
  const description = job.description ?? "";

  const companyDescription = extractCompanyDescription(description);
  const benefitsBullets = extractBulletSection(description, "Why Join Us");
  const responsibilitiesBullets = extractBulletSection(description, "Key Responsibilities and Duties");
  const requirementsBullets = extractBulletSection(description, "You Should Have Most of the Following");

  const sections: Record<SectionKey, string[]> = {
    responsibilities: responsibilitiesBullets,
    requirements: requirementsBullets,
    benefits: benefitsBullets,
  };

  // Render once with everything, then iteratively trim the priority
  // sections until under the limit. Each trim drops the last bullet
  // from the chosen section and ensures the section ends with "...".
  let rendered = render({
    jobTitle,
    jobCity,
    companyBlurb,
    companyDescription,
    benefitsBullets: sections.benefits,
    responsibilitiesBullets: sections.responsibilities,
    requirementsBullets: sections.requirements,
  });
  let truncated = false;
  let safety = 200;
  while (textLength(rendered.bodyHtml) > CHAR_LIMIT && safety-- > 0) {
    const longest = pickSectionToTrim(sections);
    if (!longest) break;
    const arr = sections[longest];
    if (arr.length === 0) {
      // Section is already empty; remove it from rotation by clearing the
      // sentinel and continuing — the next iteration will pick another.
      // (Setting to empty array means pickSectionToTrim filters it out.)
      continue;
    }
    // Drop the last bullet; keep "..." as the new trailing bullet to
    // signal truncation. If a "..." is already there, drop the bullet
    // BEFORE it so the marker stays.
    const last = arr[arr.length - 1];
    if (last === "…" || last === "...") {
      // Need to remove the bullet just before the marker.
      if (arr.length >= 2) arr.splice(arr.length - 2, 1);
      else arr.pop();
    } else {
      arr.pop();
      arr.push("…");
    }
    truncated = true;
    rendered = render({
      jobTitle,
      jobCity,
      companyBlurb,
      companyDescription,
      benefitsBullets: sections.benefits,
      responsibilitiesBullets: sections.responsibilities,
      requirementsBullets: sections.requirements,
    });
  }

  return NextResponse.json({
    ok: true,
    subject: rendered.subject,
    bodyHtml: rendered.bodyHtml,
    textLength: textLength(rendered.bodyHtml),
    truncated,
  });
}

// "a well-established Manufacturing Company" when industry is present;
// otherwise a generic phrasing so the sentence still reads cleanly.
function buildCompanyBlurb(industry: string | null): string {
  const ind = (industry ?? "").trim();
  if (!ind) return "a well-established company";
  return `a well-established ${ind} Company`;
}

function resolveCity(structured: string | null, legacy: string[]): string {
  const s = (structured ?? "").trim();
  if (s) return s;
  const first = legacy.find((l) => typeof l === "string" && l.trim().length > 0);
  if (!first) return "";
  return first.split(",")[0]?.trim() ?? "";
}

// Pull the first paragraph under "A Bit About Us" (the BreakPoint JD
// convention) as plain text. Falls back to the first non-heading,
// non-bullet paragraph if that section header isn't present.
function extractCompanyDescription(md: string): string {
  const section = extractSectionBody(md, "A Bit About Us");
  const candidate = (section ?? firstNarrativeParagraph(md) ?? "").trim();
  return stripInlineMarkdown(candidate);
}

function firstNarrativeParagraph(md: string): string | null {
  const lines = md.split(/\r?\n/);
  const buf: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (buf.length > 0) return buf.join(" ");
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^[-*+]\s/.test(line)) continue;
    buf.push(line);
  }
  return buf.length > 0 ? buf.join(" ") : null;
}

// Pull the text immediately under a heading (until the next heading or
// the end of the doc). Heading match is case-insensitive on the literal
// title — works against both ## and ### prefixes.
function extractSectionBody(md: string, title: string): string | null {
  const lines = md.split(/\r?\n/);
  const wanted = title.toLowerCase();
  let inSection = false;
  const collected: string[] = [];
  for (const raw of lines) {
    const headingMatch = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      if (inSection) break;
      const heading = headingMatch[2].toLowerCase();
      if (heading === wanted) {
        inSection = true;
        continue;
      }
      continue;
    }
    if (inSection) collected.push(raw);
  }
  if (!inSection) return null;
  return collected.join("\n").trim();
}

// Pull every "- bullet" line under a heading and return as an array of
// plain-text strings (inline markdown stripped). Returns [] if the
// section is missing or has no bullets.
function extractBulletSection(md: string, title: string): string[] {
  const section = extractSectionBody(md, title);
  if (!section) return [];
  const bullets: string[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (!m) continue;
    const text = stripInlineMarkdown(m[1]);
    if (text) bullets.push(text);
  }
  return bullets;
}

// Lightweight inline-markdown stripper: removes **bold**, __bold__,
// _italic_, and surrounding markdown punctuation. Em/en dashes get
// replaced with commas to match the rest of the codebase's house style.
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$|[.,;:!?)])/g, "$1$2")
    .replace(/(^|\s)_(?!\s)(.+?)(?<!\s)_(?=\s|$|[.,;:!?)])/g, "$1$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bulletList(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul>${items.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
}

// Plain-text character count of the rendered HTML. Tag stripping is
// just enough to give a stable measurement against the 1900-char limit
// — we don't care about exact-fidelity rendering, only relative size.
function textLength(html: string): number {
  return html
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .length;
}

function pickSectionToTrim(sections: Record<SectionKey, string[]>): SectionKey | null {
  // Choose the longest section by character count. Ties resolve by the
  // user-specified priority order: responsibilities > requirements >
  // benefits. Empty sections (or sections with just the "…" marker) are
  // skipped — nothing left to trim.
  let best: SectionKey | null = null;
  let bestLen = -1;
  for (const key of TRUNCATION_PRIORITY) {
    const arr = sections[key];
    const trimmable = arr.filter((b) => b !== "…" && b !== "...");
    if (trimmable.length === 0) continue;
    const len = trimmable.join(" ").length;
    if (len > bestLen) {
      best = key;
      bestLen = len;
    }
  }
  return best;
}

type RenderInput = {
  jobTitle: string;
  jobCity: string;
  companyBlurb: string;
  companyDescription: string;
  benefitsBullets: string[];
  responsibilitiesBullets: string[];
  requirementsBullets: string[];
};

// Final HTML render. {{candidate.first_name}} is left as a placeholder
// so the composer's existing resolver fills it from effectiveContext.
function render(input: RenderInput): { subject: string; bodyHtml: string } {
  const jobTitle = input.jobTitle || "this role";
  const jobCity = input.jobCity || "your area";
  const subject = `${jobTitle} - Immediate Opportunity in ${jobCity}`;

  const intro = `Hi {{candidate.first_name}},`;
  const lede =
    `My client, ${escapeHtml(input.companyBlurb)}, is looking to add a ${escapeHtml(jobTitle)} ` +
    `to the growing team in ${escapeHtml(jobCity)}.`;
  const ask = "Are you interested?";
  const companyHeader = `<p><strong>${escapeHtml(jobTitle)}:</strong></p>`;
  const companyPara = input.companyDescription
    ? `<p>${escapeHtml(input.companyDescription)}</p>`
    : "";
  const whyHeader = `<p><strong>Why Join Us?</strong></p>`;
  const whyList = bulletList(input.benefitsBullets);
  const detailsHeader = `<p><strong>Job Details:</strong></p>`;
  const respHeader = `<p><strong>Key Responsibilities and Duties:</strong></p>`;
  const respList = bulletList(input.responsibilitiesBullets);
  const reqHeader = `<p><strong>You should have most of the following:</strong></p>`;
  const reqList = bulletList(input.requirementsBullets);

  const parts = [
    `<p>${intro}</p>`,
    `<p>${lede}</p>`,
    `<p>${ask}</p>`,
    companyHeader,
    companyPara,
    whyHeader,
    whyList,
    detailsHeader,
    respHeader,
    respList,
    reqHeader,
    reqList,
  ].filter(Boolean);

  return { subject, bodyHtml: parts.join("") };
}
