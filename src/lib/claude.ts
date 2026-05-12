import Anthropic from "@anthropic-ai/sdk";
import { normalizeToE164 } from "@/lib/rf-payload-shapes";
import { stripMarkdownToPlain as stripMarkdownToPlainImpl } from "@/lib/markdown-to-plain";

// DOCX mime types and filename suffixes we can extract text from via mammoth.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function looksLikeDocx(filename: string, mimeType: string): boolean {
  if (mimeType === DOCX_MIME) return true;
  return filename.toLowerCase().endsWith(".docx");
}

// Marker prefix so callers can distinguish "this .docx has no readable
// text at all" from other parse failures and surface a targeted UX.
export const DOCX_UNPARSEABLE_PREFIX = "DOCX_UNPARSEABLE";

// Dynamic imports so mammoth / jszip stay out of the edge bundle and
// Next's loader doesn't try to inline their runtime-require-based zip
// plumbing.
//
// Complex templates (text boxes, nested tables, drawing-canvas layouts)
// sometimes produce empty or near-empty output from mammoth. When that
// happens we fall back to reading the raw XML parts directly and
// harvesting every <w:t> text node. Only if both paths come up empty do
// we give up and throw DOCX_UNPARSEABLE.
async function extractDocxText(data: Buffer): Promise<string> {
  const fromMammoth = await tryMammothExtract(data);
  if (fromMammoth.trim().length >= 50) return fromMammoth;

  const fromRawXml = await tryRawXmlExtract(data);
  if (fromRawXml.trim().length >= 50) return fromRawXml;

  // Prefer whichever path yielded *any* text over giving up entirely —
  // Claude can still use a short excerpt if that's all we have.
  const longer = fromRawXml.length >= fromMammoth.length ? fromRawXml : fromMammoth;
  if (longer.trim().length > 0) return longer;

  throw new Error(`${DOCX_UNPARSEABLE_PREFIX}: no readable text found in the document.`);
}

async function tryMammothExtract(data: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
    if (typeof extract !== "function") return "";
    const result = await extract({ buffer: data });
    return result.value ?? "";
  } catch {
    return "";
  }
}

async function tryRawXmlExtract(data: Buffer): Promise<string> {
  try {
    const JSZipMod = await import("jszip");
    const JSZip = (JSZipMod.default ?? JSZipMod) as typeof import("jszip");
    const zip = await JSZip.loadAsync(data);
    const paths = Object.keys(zip.files).filter((p) => {
      if (!p.startsWith("word/")) return false;
      if (!p.endsWith(".xml")) return false;
      if (p.endsWith(".rels")) return false;
      if (p === "word/theme/theme1.xml") return false;
      if (p === "word/styles.xml") return false;
      if (p === "word/settings.xml") return false;
      if (p === "word/fontTable.xml") return false;
      if (p === "word/webSettings.xml") return false;
      return true;
    });
    const parts: string[] = [];
    for (const path of paths) {
      const entry = zip.files[path];
      if (!entry || entry.dir) continue;
      const xml = await entry.async("string");
      // Grab every <w:t ...>text</w:t>. Inline fields can break text across
      // siblings; this still catches each chunk.
      const re = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const t = decodeXmlEntities(m[1]);
        if (t) parts.push(t);
      }
      // Paragraph breaks so Claude can see line boundaries.
      if (xml.includes("</w:p>")) parts.push("\n");
    }
    return parts.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  } catch {
    return "";
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Strip any residual markdown Claude may emit even when instructed not to.
// Implementation lives in @/lib/markdown-to-plain so client-side modules
// (merge-fields.ts and friends) can call it without pulling the Anthropic
// SDK into the browser bundle. Re-exported here so existing callers keep
// working unchanged.
export const stripMarkdownToPlain = stripMarkdownToPlainImpl;

// Sonnet 4.6 — single shared model across every Claude caller in Ace
// (lib/claude generators, /api/mail/ai-compose, /api/email/edit-with-
// claude, /api/calls/summary, /api/ai-workspace, clients/new actions).
// Sampling params (temperature/top_p/top_k) and budget_tokens are
// removed on 4.x — do not re-add them.
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let cached: Anthropic | null = null;

export function getClaude(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and to the Vercel project environment.",
    );
  }
  if (!cached) cached = new Anthropic({ apiKey: key });
  return cached;
}

export type BenefitsAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export type ParsedExperience = {
  designation: string | null;
  organization: string | null;
  from_year: number | null;
  to_year: number | null;
  description: string | null;
};

export type ParsedEducation = {
  school: string | null;
  degree: string | null;
  from_year: number | null;
  to_year: number | null;
  description: string | null;
};

export type ParsedCandidate = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  current_designation: string | null;
  current_organization: string | null;
  location: string | null;
  linkedin_profile: string | null;
  skills: string[];
  notes: string | null;
  experience: ParsedExperience[];
  education: ParsedEducation[];
};

const EMPTY_CANDIDATE: ParsedCandidate = {
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  current_designation: null,
  current_organization: null,
  location: null,
  linkedin_profile: null,
  skills: [],
  notes: null,
  experience: [],
  education: [],
};

// Parses a resume PDF and/or a pasted chunk of text (LinkedIn profile text,
// recruiter notes) into structured candidate fields for editing in the UI.
// LinkedIn URL is passed through so we can echo it into the final record —
// LinkedIn blocks automated URL fetches, so we don't attempt to scrape here.
export async function parseCandidateFields(params: {
  resume?: { filename: string; mimeType: string; data: Buffer };
  pastedText?: string;
  linkedinUrl?: string;
}): Promise<ParsedCandidate> {
  const resume = params.resume;
  const pasted = (params.pastedText ?? "").trim();
  const linkedinUrl = (params.linkedinUrl ?? "").trim();

  if (!resume && !pasted && !linkedinUrl) {
    throw new Error("Upload a resume, paste profile text, or enter a LinkedIn URL first.");
  }

  const anthropic = getClaude();
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (resume) {
    if (resume.mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: resume.data.toString("base64"),
        },
        title: resume.filename,
      });
    } else if (looksLikeDocx(resume.filename, resume.mimeType)) {
      // .docx is a zip — toString("utf-8") yields binary garbage Claude can't
      // parse. Extract real text via mammoth first.
      const docText = await extractDocxText(resume.data);
      if (!docText.trim()) {
        throw new Error("Couldn't read any text from the Word document. Try exporting it as a PDF and re-uploading.");
      }
      content.push({
        type: "text",
        text: `--- Resume (${resume.filename}) ---\n${docText.slice(0, 80_000)}`,
      });
    } else if (resume.mimeType === LEGACY_DOC_MIME || resume.filename.toLowerCase().endsWith(".doc")) {
      throw new Error("Legacy .doc files aren't supported. Save the file as .docx or export to PDF and retry.");
    } else {
      content.push({
        type: "text",
        text: `--- Resume (${resume.filename}) ---\n${resume.data.toString("utf-8").slice(0, 80_000)}`,
      });
    }
  }

  if (pasted) {
    content.push({
      type: "text",
      text: `--- Pasted profile / notes ---\n${pasted}`,
    });
  }

  if (linkedinUrl) {
    content.push({
      type: "text",
      text: `--- LinkedIn URL (store, do not fabricate fields from this) ---\n${linkedinUrl}`,
    });
  }

  content.push({
    type: "text",
    text:
      "Extract candidate fields from the source above. Return ONLY a JSON object with this exact shape — no prose, no markdown fences, no preamble:\n" +
      "{\n" +
      '  "first_name": string|null,\n' +
      '  "last_name": string|null,\n' +
      '  "email": string|null,\n' +
      '  "phone": string|null,\n' +
      '  "current_designation": string|null,\n' +
      '  "current_organization": string|null,\n' +
      '  "location": string|null,\n' +
      '  "linkedin_profile": string|null,\n' +
      '  "skills": string[],\n' +
      '  "notes": string|null,\n' +
      '  "experience": [ { "designation": string|null, "organization": string|null, "from_year": number|null, "to_year": number|null, "description": string|null } ],\n' +
      '  "education":  [ { "school": string|null, "degree": string|null, "from_year": number|null, "to_year": number|null, "description": string|null } ]\n' +
      "}\n\n" +
      "Rules:\n" +
      "- Use null (not empty string) for any field not present in the source.\n" +
      "- 'current_designation' is the candidate's present job title; 'current_organization' is their present employer. A role is 'current' if its end date is 'Current', 'Present', 'Now', or blank — those all mean the candidate is still there. Prefer the most recent role explicitly marked 'Current'/'Present'/blank end date. If no role is explicitly current, use the most recent dated role. These MUST be non-empty whenever the resume lists any work history at all — never return '' here, use null only if the resume has zero work experience.\n" +
      "- 'location' should be 'City, ST' if US, otherwise 'City, Country'.\n" +
      "- 'phone' keep the digits and country code as given; don't reformat.\n" +
      "- 'skills' is a short deduplicated array of 5–12 hard skills. Omit soft skills.\n" +
      "- 'linkedin_profile' is the full URL if one is present in the source. If only a LinkedIn URL was provided as input, echo it here.\n" +
      "- 'notes' is a short (2–4 sentence) summary of the candidate's experience highlights. Null if nothing notable.\n" +
      "- 'experience' is every work/job role found on the resume, most-recent-first. 'from_year' and 'to_year' are 4-digit years; if the role is still current set 'to_year' to null (do NOT write 'Current'/'Present'/'Now'). 'description' is a 1–3 sentence summary of that role (bullet-flattened). Return [] if no experience found.\n" +
      "- 'education' is every education entry found on the resume, most-recent-first. Same year rules. 'degree' examples: 'BS Computer Science', 'MBA', 'BA Economics'. Return [] if no education found.\n" +
      "- Never invent data. If a field is uncertain or missing, return null.",
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system:
      "You extract candidate fields from resumes and profiles for a recruiting CRM. " +
      "You return strict JSON matching the schema the user provides. You never fabricate fields. " +
      "If a source is empty or unreadable, return the schema with all fields set to null (and skills: []).",
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = safeParseJSON(text);
  if (!parsed) {
    // eslint-disable-next-line no-console
    console.error("[parseCandidateFields] Claude returned non-JSON response. Raw text:", text.slice(0, 2000));
    throw new Error("Claude didn't return valid JSON. Try again, or paste the profile text into the notes field manually.");
  }

  // Verbose audit log — this is what shows up in Vercel runtime logs so we
  // can diagnose "why didn't current_designation populate" when a recruiter
  // reports a miss-parse. Trim the raw blocks so the log line stays under
  // Vercel's per-line cap.
  // eslint-disable-next-line no-console
  console.log(
    "[parseCandidateFields] Claude raw response (first 1500 chars):",
    text.slice(0, 1500),
  );
  // eslint-disable-next-line no-console
  console.log("[parseCandidateFields] parsed JSON:", {
    first_name: parsed.first_name ?? null,
    last_name: parsed.last_name ?? null,
    email: parsed.email ?? null,
    current_designation: parsed.current_designation ?? null,
    current_organization: parsed.current_organization ?? null,
    experienceCount: Array.isArray(parsed.experience) ? parsed.experience.length : 0,
    educationCount: Array.isArray(parsed.education) ? parsed.education.length : 0,
    skillsCount: Array.isArray(parsed.skills) ? parsed.skills.length : 0,
  });

  const experience = normalizeExperience(parsed.experience);
  // Claude is asked to always fill current_designation/current_organization
  // when any experience row is present, but in practice it sometimes
  // returns "" or omits them. Coerce "" → null up-front so consumers can
  // reliably fall through to the first experience row via `??`. Then if
  // nulls remain and experience has a "current" role (to_year === null,
  // i.e. still there), backfill from that row so the caller never has to
  // re-derive it. A "current" role is preferred over the most-recent
  // dated role — Sidney's "North Canton City Schools · August 2022-Current"
  // is an active role even though a past dated role might sort first in
  // some layouts.
  const currentRole =
    experience.find((r) => r.to_year == null && (r.designation || r.organization)) ??
    experience[0] ??
    null;
  const rawDesignation = toStringOrNull(parsed.current_designation);
  const rawOrganization = toStringOrNull(parsed.current_organization);
  const finalDesignation = rawDesignation ?? currentRole?.designation ?? null;
  const finalOrganization = rawOrganization ?? currentRole?.organization ?? null;
  // eslint-disable-next-line no-console
  console.log("[parseCandidateFields] backfill result:", {
    rawDesignation,
    rawOrganization,
    currentRoleDesignation: currentRole?.designation ?? null,
    currentRoleOrganization: currentRole?.organization ?? null,
    finalDesignation,
    finalOrganization,
  });
  return {
    ...EMPTY_CANDIDATE,
    ...parsed,
    phone: normalizeToE164(parsed.phone),
    current_designation: finalDesignation,
    current_organization: finalOrganization,
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown): s is string => typeof s === "string") : [],
    linkedin_profile: parsed.linkedin_profile ?? linkedinUrl ?? null,
    experience,
    education: normalizeEducation(parsed.education),
  };
}

function toYearOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const y = Math.trunc(v);
    return y > 1900 && y < 2100 ? y : null;
  }
  if (typeof v === "string") {
    const n = parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 1900 && n < 2100) return n;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function normalizeExperience(raw: unknown): ParsedExperience[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): ParsedExperience | null => {
      if (!e || typeof e !== "object") return null;
      const r = e as Record<string, unknown>;
      const designation = toStringOrNull(r.designation ?? r.title);
      const organization = toStringOrNull(r.organization ?? r.company ?? r.employer);
      if (!designation && !organization) return null;
      return {
        designation,
        organization,
        from_year: toYearOrNull(r.from_year ?? r.start_year ?? r.start),
        to_year: toYearOrNull(r.to_year ?? r.end_year ?? r.end),
        description: toStringOrNull(r.description ?? r.summary),
      };
    })
    .filter((x): x is ParsedExperience => x !== null)
    .slice(0, 15);
}

function normalizeEducation(raw: unknown): ParsedEducation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): ParsedEducation | null => {
      if (!e || typeof e !== "object") return null;
      const r = e as Record<string, unknown>;
      const school = toStringOrNull(r.school ?? r.institution ?? r.university);
      const degree = toStringOrNull(r.degree ?? r.qualification);
      if (!school && !degree) return null;
      return {
        school,
        degree,
        from_year: toYearOrNull(r.from_year ?? r.start_year ?? r.start),
        to_year: toYearOrNull(r.to_year ?? r.end_year ?? r.end ?? r.graduation_year),
        description: toStringOrNull(r.description ?? r.notes),
      };
    })
    .filter((x): x is ParsedEducation => x !== null)
    .slice(0, 10);
}

function safeParseJSON(raw: string): Partial<ParsedCandidate> | null {
  const tryParse = (s: string): Partial<ParsedCandidate> | null => {
    try {
      return JSON.parse(s) as Partial<ParsedCandidate>;
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

// Extract and summarize the key terms of a placement fee agreement. PDF-only
// for now — .doc/.docx binaries aren't natively readable by Claude without
// server-side text extraction, which we'll add if it becomes a blocker.
export async function summarizeAgreementTerms(params: {
  filename: string;
  mimeType: string;
  data: Buffer;
}): Promise<string> {
  if (params.mimeType !== "application/pdf") {
    throw new Error("Only PDF agreements can be auto-summarized right now. Re-upload as PDF to use this.");
  }

  const anthropic = getClaude();

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system:
      "You extract key commercial terms from recruiting / placement fee agreements. You are precise and conservative — " +
      "you never invent numbers or clauses, and if a term isn't present you write 'Not specified.'",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: params.data.toString("base64"),
            },
            title: params.filename,
          },
          {
            type: "text",
            text:
              "Extract the key commercial terms from this placement / recruiting fee agreement. " +
              "Output ONLY a bulleted list — no intro, no summary paragraph, no trailing commentary, no markdown, no code fences. " +
              "Each line is plain text in the form: `- Label: value`. No asterisks, no bold syntax. " +
              "Keep values short and factual (numbers, percentages, day counts, state names). " +
              "If a term isn't stated in the document, write the value as 'Not specified.' — never guess.\n\n" +
              "Produce these bullets, in this order (skip any that aren't in the doc except the six core ones which always appear):\n" +
              "- Fee Percentage: (percentage + base — e.g. '25% of first-year base salary')\n" +
              "- Payment Terms: (e.g. 'Net 15 from start date')\n" +
              "- Guarantee Period: (e.g. '90 days, prorated replacement')\n" +
              "- Minimum Fee: (dollar amount, or 'None')\n" +
              "- Candidate Ownership Period: (e.g. '12 months from introduction')\n" +
              "- Governing Law: (state/jurisdiction)\n" +
              "- {Other term label}: (add a bullet for any other notable/custom term — indemnification cap, arbitration, non-solicit scope, background-check responsibility, etc. One bullet per term. Omit if nothing else is notable.)\n\n" +
              "No other content. Just the bullets.",
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned no summary. Try again or check the PDF is readable.");
  return stripMarkdownToPlain(text);
}

// Takes an uploaded job description (PDF / DOCX / pasted text) and produces
// an anonymous BreakPoint-formatted JD as GitHub-flavored markdown. Mirrors
// the format spec used by the /api/jobs/generate-jd route (Path A) so the
// downstream ReactMarkdown renderer on the JD tab and the /jobs/new preview
// can share styling. Output structure:
//
//   ## A Bit About Us
//   (paragraph)
//
//   ## Why Join Us
//   - bullet
//
//   ## Job Details
//
//   ### Key Responsibilities and Duties
//   - bullet
//
//   ### You Should Have Most of the Following
//   - bullet
//
//   ### Nice to Have    (optional — omitted entirely if the source has none)
//   - bullet
//
// Top-level sections use '## ', sub-sections under Job Details use '### ',
// bullets use '- ' (hyphen + space). No preamble before the first heading,
// no trailing sign-off after the final bullet.
export async function generateJobDescription(params: {
  sourceFile?: { filename: string; mimeType: string; data: Buffer };
  sourceText?: string;
  jobTitle?: string;
}): Promise<string> {
  const anthropic = getClaude();
  const pasted = (params.sourceText ?? "").trim();
  const file = params.sourceFile;
  if (!file && !pasted) {
    throw new Error("Upload a JD file or paste some source text to generate from.");
  }

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (file) {
    if (file.mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: file.data.toString("base64"),
        },
        title: file.filename,
      });
    } else if (looksLikeDocx(file.filename, file.mimeType)) {
      // Extract real text from the .docx zip rather than sending raw binary.
      const docText = await extractDocxText(file.data);
      if (!docText.trim()) {
        throw new Error("Couldn't read any text from the Word document. Try exporting it as a PDF and re-uploading.");
      }
      content.push({
        type: "text",
        text: `--- File: ${file.filename} ---\n${docText.slice(0, 80_000)}`,
      });
    } else if (file.mimeType === LEGACY_DOC_MIME || file.filename.toLowerCase().endsWith(".doc")) {
      throw new Error("Legacy .doc files aren't supported. Save the file as .docx or export to PDF and retry.");
    } else {
      const maybeText = file.data.toString("utf-8");
      content.push({
        type: "text",
        text: `--- File: ${file.filename} ---\n${maybeText.slice(0, 80_000)}`,
      });
    }
  }

  if (pasted) {
    content.push({
      type: "text",
      text: `--- Pasted source ---\n${pasted}`,
    });
  }

  const titleHint = params.jobTitle?.trim() ? `\nJob title (for reference): ${params.jobTitle.trim()}` : "";

  content.push({
    type: "text",
    text:
      "Reformat the source above into an anonymous BreakPoint Talent job description, as GitHub-flavored markdown. " +
      "Strip any client name, logos, recruiter names, email addresses, and phone numbers." +
      titleHint +
      "\n\n" +
      "Output MUST follow this EXACT structure, in this order, with the literal section titles shown. " +
      "Top-level sections use '## ' (H2). Sub-sections under Job Details use '### ' (H3). Bullets use '- ' (hyphen + space). " +
      "No preamble before the first '## A Bit About Us'. No trailing sign-off after the final bullet.\n\n" +
      "## A Bit About Us\n" +
      "<2 to 4 sentence paragraph describing the company in generic terms — industry, size, stage, mission. Neutral phrasing like 'Our client is…' or 'The team is…'. No client name. No fabrication.>\n\n" +
      "## Why Join Us\n" +
      "- <selling point>\n" +
      "- <selling point>\n" +
      "- <selling point>\n" +
      "- <selling point>\n" +
      "(4 to 7 bullets — growth, team, mission, comp, culture, remote/hybrid, etc. Skip topics the source does not support — never fabricate.)\n\n" +
      "## Job Details\n" +
      "(No body copy directly under this header — only the sub-sections below.)\n\n" +
      "### Key Responsibilities and Duties\n" +
      "- <verb-led responsibility>\n" +
      "- <verb-led responsibility>\n" +
      "- <verb-led responsibility>\n" +
      "(5 to 10 bullets, concrete and day-to-day, pulled from the source.)\n\n" +
      "### You Should Have Most of the Following\n" +
      "- <qualification / skill / experience>\n" +
      "- <qualification / skill / experience>\n" +
      "- <qualification / skill / experience>\n" +
      "(5 to 10 bullets — hard requirements: years, certifications, core skills.)\n\n" +
      "### Nice to Have\n" +
      "- <optional qualification>\n" +
      "OMIT this entire sub-section (heading and all) if no preferred / nice-to-have items are present in the source — do not write 'None' or 'N/A'.\n\n" +
      "Never mention 'BreakPoint' or 'the recruiter' in the body. Confident, concise recruiter voice.",
  });

  const system =
    "You are BreakPoint Talent's recruiter copy assistant. You turn client-supplied job descriptions into polished, anonymous candidate-facing write-ups in the BreakPoint voice — professional, recruiter-friendly, never cheesy. " +
    "Output is GitHub-flavored markdown.\n\n" +
    "MARKDOWN HEADING RULES (these are non-negotiable):\n" +
    "- The top-level sections 'A Bit About Us', 'Why Join Us', and 'Job Details' MUST each start with '## ' (two hash characters plus a space).\n" +
    "- The sub-sections under Job Details — 'Key Responsibilities and Duties', 'You Should Have Most of the Following', and 'Nice to Have' (when present) — MUST each start with '### ' (three hash characters plus a space).\n" +
    "- NEVER omit the '## ' prefix on a top-level section. NEVER use '### ' for a top-level section. NEVER use '## ' for a sub-section.\n" +
    "- NEVER use plain text (e.g. 'Job Details' on its own line, or 'Job Details:'). The heading must always be a markdown heading.\n" +
    "- Use the EXACT section titles shown above — do not paraphrase to 'About Us' / 'What you'll do' / etc.\n" +
    "- Bullets always use '- ' (hyphen + space). Never '•'. Never '*'. Never '1.'.\n" +
    "- No preamble before the first heading. No sign-off after the final bullet.\n" +
    "- Do NOT use bold/italic emphasis on body copy. Do not add code fences. Do not add horizontal rules.\n" +
    "- NEVER use em dashes (the long '—' character) or en dashes ('–'). Use a comma, colon, parentheses, or period instead.\n" +
    "- Never fabricate compensation, benefits, or details that aren't in the source. " +
    "Every response must contain all five required headers: 'A Bit About Us', 'Why Join Us', 'Job Details', 'Key Responsibilities and Duties', AND 'You Should Have Most of the Following'.";

  async function runOnce(messages: Anthropic.Messages.MessageParam[]): Promise<string> {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages,
    });
    const raw = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    // JD is stored as markdown so the JD preview can render H2/H3 hierarchy.
    // Merge-field resolvers ([Job Description] / {{job.description}}) strip
    // the markdown back to plain text on email send.
    return raw;
  }

  const firstPass = await runOnce([{ role: "user", content }]);
  if (!firstPass) throw new Error("Claude returned no description. Try again with cleaner source material.");

  const missing = missingRequiredJdHeaders(firstPass);
  if (missing.length === 0) return firstPass;

  // Retry once if required headers didn't make it. Include the first pass as
  // assistant prior context and call out the missing pieces explicitly.
  const retryContent: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text:
        "The previous draft is missing these required section headers: " +
        missing.join(", ") +
        ". " +
        "Please produce the full JD again with ALL required sections present, as GitHub-flavored markdown: every top-level section starts with '## ', every sub-section under Job Details starts with '### ', every bullet starts with '- ' (hyphen + space). " +
        "Keep the structure: ## A Bit About Us, ## Why Join Us, ## Job Details (containing ### Key Responsibilities and Duties AND ### You Should Have Most of the Following).",
    },
  ];
  const secondPass = await runOnce([
    { role: "user", content },
    { role: "assistant", content: firstPass },
    { role: "user", content: retryContent },
  ]);
  return secondPass || firstPass;
}

export type ExtractedJdFields = {
  title?: string;
  location?: string;
  salaryLow?: number;
  salaryHigh?: number;
  salaryType?: "SALARY" | "HOURLY";
};

// Lightweight follow-up extractor that runs after generateJobDescription
// produces the markdown JD. The /jobs/new form auto-fills empty Job Title /
// Location / Salary Low / Salary High inputs (and flips the Salary Type
// dropdown when an hourly rate is detected) from whatever Claude can find
// in the generated text. Best-effort — callers ignore failures silently.
export async function extractJobFieldsFromGeneratedJd(markdown: string): Promise<ExtractedJdFields> {
  const text = (markdown ?? "").trim();
  if (!text) return {};

  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system:
      "You extract structured fields from a job description for a recruiting CRM. " +
      "Return STRICT JSON only — no prose, no markdown fences. Never invent values.",
    messages: [
      {
        role: "user",
        content:
          "Extract the following fields from this job description. Return strict JSON only, no markdown, no explanation. Omit any field you are not confident about.\n\n" +
          "Fields:\n" +
          "- title: string — the job title\n" +
          "- location: string — the single most specific location mentioned. Prefer a format like 'Florence, KY' or 'Florence, KY 41042' over region descriptions like 'Cincinnati/Northern Kentucky'. If a commute requirement lists a specific city/zip, use that.\n" +
          "- salaryLow: number — the lower bound of compensation, in dollars. If hourly, convert to the hourly rate as a number (e.g. 20 for $20/hr).\n" +
          "- salaryHigh: number — the upper bound of compensation, in dollars. If hourly, use the hourly rate.\n" +
          "- salaryType: string — either 'SALARY' or 'HOURLY'. Use 'HOURLY' if the compensation is described as per hour, /hr, hourly, or an hourly rate. Use 'SALARY' if annual or salaried.\n\n" +
          "=== Job Description ===\n" +
          text.slice(0, 50_000),
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = safeExtractJson(raw);
  if (!parsed) return {};

  const fields: ExtractedJdFields = {};
  if (typeof parsed.title === "string" && parsed.title.trim()) fields.title = parsed.title.trim();
  if (typeof parsed.location === "string" && parsed.location.trim()) fields.location = parsed.location.trim();
  if (typeof parsed.salaryLow === "number" && Number.isFinite(parsed.salaryLow) && parsed.salaryLow >= 0) {
    fields.salaryLow = parsed.salaryLow;
  }
  if (typeof parsed.salaryHigh === "number" && Number.isFinite(parsed.salaryHigh) && parsed.salaryHigh >= 0) {
    fields.salaryHigh = parsed.salaryHigh;
  }
  if (typeof parsed.salaryType === "string") {
    const st = parsed.salaryType.trim().toUpperCase();
    if (st === "HOURLY" || st === "SALARY") fields.salaryType = st;
  }
  return fields;
}

function safeExtractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return tryParse(m[0]);
}

const REQUIRED_JD_HEADERS = [
  "A Bit About Us",
  "Why Join Us",
  "Job Details",
  "Key Responsibilities and Duties",
  "You Should Have Most of the Following",
] as const;

function missingRequiredJdHeaders(text: string): string[] {
  const lower = text.toLowerCase();
  return REQUIRED_JD_HEADERS.filter((h) => !lower.includes(h.toLowerCase()));
}

// Candidate submittal writeup for a specific job. Produces the exact
// BreakPoint format the recruiter pastes into the submittal email. Plain text
// only — no markdown — because it goes into a plain-text email body (the
// composer's textarea). Sections are fixed and lines under each header are
// short/scannable.
export type SubmittalInput = {
  candidate: {
    firstName: string;
    lastName: string;
    title: string;
    employer: string;
    location: string;
    skills: string[];
    experienceSummary: string;
    notes: string;
    expectedSalary: string;
    linkedin: string;
  };
  job: {
    title: string;
    clientName: string;
    locations?: string[];
    salaryRange?: string;
    employmentType?: string;
    jobType?: string;
    department?: string;
    experienceRange?: string;
    description?: string;
    customFields?: Array<{ name: string; value: string }>;
  };
  clientContactFirstName?: string;
};

export async function generateSubmittalWriteup(input: SubmittalInput): Promise<string> {
  const anthropic = getClaude();
  const fullName = [input.candidate.firstName, input.candidate.lastName].filter(Boolean).join(" ") || "Candidate";
  const firstName = input.candidate.firstName || "this candidate";
  const clientFirst = (input.clientContactFirstName ?? "").trim() || "there";

  const customFieldLines = (input.job.customFields ?? [])
    .filter((cf) => cf.name && cf.value)
    .map((cf) => `  - ${cf.name}: ${cf.value}`)
    .join("\n");

  const roleBlock =
    `Target role: ${input.job.title}\n` +
    `Client: ${input.job.clientName || "—"}\n` +
    `Role location(s): ${(input.job.locations ?? []).join(", ") || "—"}\n` +
    `Employment type: ${[input.job.jobType, input.job.employmentType].filter(Boolean).join(" · ") || "—"}\n` +
    `Salary range: ${input.job.salaryRange || "—"}\n` +
    `Department: ${input.job.department || "—"}\n` +
    `Experience range required: ${input.job.experienceRange || "—"}\n` +
    (customFieldLines ? `Other role fields:\n${customFieldLines}\n` : "") +
    (input.job.description
      ? `\nJob description:\n${input.job.description.trim().slice(0, 8000)}\n`
      : "");

  const candidateBlock =
    `Candidate: ${fullName}\n` +
    `Current title: ${input.candidate.title || "—"}\n` +
    `Current employer: ${input.candidate.employer || "—"}\n` +
    `Location: ${input.candidate.location || "—"}\n` +
    `Expected salary: ${input.candidate.expectedSalary || "—"}\n` +
    `LinkedIn: ${input.candidate.linkedin || "—"}\n` +
    `Skills: ${(input.candidate.skills || []).slice(0, 20).join(", ") || "—"}\n` +
    `Experience summary:\n${input.candidate.experienceSummary || "—"}\n` +
    `Recruiter notes:\n${input.candidate.notes || "—"}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1400,
    system:
      "You write candidate submittal emails for BreakPoint Talent recruiters. " +
      "The output goes straight into the recruiter's submittal email body, they do not reformat it. " +
      "Section headers MUST be wrapped in **double-asterisks** (Markdown bold). The email renderer turns those into real bold tags in Gmail. " +
      "Bullets MUST use a leading dash followed by a space ('- '). " +
      "Do NOT use any other markdown (no #, no *, no _ italics, no numbered lists). " +
      "NEVER use em dashes (the long `—` character) anywhere in the output. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (`-`) are fine for compound words and bullet markers. " +
      "Confident, concise, recruiter voice. Never fabricate facts not in the source data. " +
      "Always tie the candidate's background to the specific role: this is a targeted pitch, not a generic summary.",
    messages: [
      {
        role: "user",
        content:
          `You are writing a candidate submittal for ${fullName} for the ${input.job.title} role at ${input.job.clientName || "the client"}. ` +
          "Write a targeted submittal email that makes the case for why THIS candidate fits THIS role — not a generic candidate summary. " +
          "Use the role context (title, location, employment type, salary range, experience range, description if present, custom fields) to frame the candidate. " +
          "In 'What [She/He] Brings' and 'Technically', explicitly reference experience and skills from the candidate that align with what the role needs. " +
          "If there's a real mismatch (e.g. candidate's stack doesn't match), stay honest — don't manufacture fit.\n\n" +
          "Output MUST match this EXACT structure, with the `**…**` bold wrappers and the dash bullets preserved verbatim:\n\n" +
          `Hi ${clientFirst},\n\n` +
          `Here is a candidate I wanted to show you for the ${input.job.title} role.\n\n` +
          `**About ${firstName}:**\n` +
          "<2–3 sentence paragraph — who they are, where they're based, most relevant experience, closest parallel to what the job requires>\n\n" +
          "**What [She/He] Brings:**\n" +
          "- <Bullet 1 — strongest relevant point, naturally labeled>\n" +
          "- <Bullet 2>\n" +
          "- <Bullet 3>\n" +
          "- <Bullet 4>\n\n" +
          "**Technically:**\n" +
          "- <Honest assessment of their technical toolkit — concrete tools / stacks / certifications that match the role>\n\n" +
          "**Comp Target:** <range — if unknown, say 'Open / to be discussed'. If the role posts a range and the candidate's target falls inside it, say so.>\n\n" +
          "**Location:** <city, state — note remote/hybrid/on-site posture if relevant>\n\n" +
          "Let me know if you'd like to set up an interview with [her/him] this week.\n\n" +
          "Rules:\n" +
          "- Replace [She/He] and [her/him] with the correct pronouns — infer from the candidate's name if possible, otherwise use 'them/they'.\n" +
          "- Keep the `**…**` bold wrappers on the section headers, the `**Comp Target:**` and `**Location:**` labels, and the `**About [Name]:**` header. Do not bold body copy.\n" +
          "- Dash bullets ('- ') only — never '•', '*', or numbered lists.\n" +
          "- Do NOT include a signature or 'Dear' — the recruiter's email signature handles closings.\n" +
          "- Do NOT paraphrase the whole job description — pull the parts that matter and tie them to the candidate.\n" +
          "- Never invent facts not in the source data. If a field is missing, omit that line honestly.\n\n" +
          "=== Role context ===\n" +
          roleBlock +
          "\n=== Candidate profile ===\n" +
          candidateBlock,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned no submittal writeup. Try again.");
  // Preserve `**…**` / `__…__` markers — they're load-bearing for the HTML
  // conversion on send. stripMarkdownToPlain would flatten them.
  return text;
}

// Summarizes benefits material — PDFs and/or pasted text — into a clean,
// scannable brief for a recruiter sharing benefits with a candidate.
export async function summarizeBenefits(params: {
  pastedText?: string;
  attachments?: BenefitsAttachment[];
}): Promise<string> {
  const anthropic = getClaude();
  const parts = params.attachments ?? [];
  const pasted = (params.pastedText ?? "").trim();

  if (parts.length === 0 && !pasted) {
    throw new Error("Nothing to summarize — upload a file or paste some text.");
  }

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  for (const file of parts) {
    if (file.mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: file.data.toString("base64"),
        },
        title: file.filename,
      });
    } else if (looksLikeDocx(file.filename, file.mimeType)) {
      const docText = await extractDocxText(file.data);
      content.push({
        type: "text",
        text: `--- File: ${file.filename} ---\n${docText.slice(0, 50_000)}`,
      });
    } else {
      // Text-ish fallback: .txt/.md/etc. Skips binary legacy .doc which is unsupported.
      const maybeText = file.data.toString("utf-8");
      content.push({
        type: "text",
        text: `--- File: ${file.filename} ---\n${maybeText.slice(0, 50_000)}`,
      });
    }
  }

  if (pasted) {
    content.push({
      type: "text",
      text: `--- Pasted notes ---\n${pasted}`,
    });
  }

  content.push({
    type: "text",
    text:
      "Extract the key benefits facts for a candidate. " +
      "Output ONLY a bulleted list — no intro, no summary paragraph, no trailing commentary, no markdown, no code fences. " +
      "Each line is plain text in the form: `- Label: value`. No asterisks, no bold syntax. " +
      "Keep values short and factual — numbers, carriers, waiting-period days, match percentages. " +
      "Do not invent details. If a category isn't in the source, skip the bullet.\n\n" +
      "Produce bullets for whichever of these are present:\n" +
      "- Medical: (carrier, employee cost, plan tiers)\n" +
      "- Dental: (carrier, employee cost)\n" +
      "- Vision: (carrier, employee cost)\n" +
      "- HSA/FSA: (employer contribution, if any)\n" +
      "- 401(k): (match %, vesting, eligibility)\n" +
      "- PTO: (days/year, accrual rate)\n" +
      "- Holidays: (number/year)\n" +
      "- Parental Leave: (weeks paid)\n" +
      "- Bonus / Commission / Equity: (structure)\n" +
      "- Remote / Hybrid: (policy)\n" +
      "- Stipends / Perks: (commuter, home office, wellness, etc.)\n" +
      "- Eligibility / Waiting Period: (days to enroll)\n" +
      "- {Other}: add a bullet per notable item not covered above. Omit if nothing else is notable.\n\n" +
      "No other content. Just the bullets. If the source is empty or unreadable, output exactly one line: " +
      "'- Source: No readable benefits info.'",
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system:
      "You extract benefits facts from carrier packets, HR PDFs, and recruiter notes. " +
      "Be factual — only summarize what's present. Never speculate about coverage levels that aren't stated.",
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned no summary text. Try again or adjust the inputs.");
  return stripMarkdownToPlain(text);
}
