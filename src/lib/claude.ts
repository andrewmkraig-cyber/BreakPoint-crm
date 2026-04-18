import Anthropic from "@anthropic-ai/sdk";
import { normalizeToE164 } from "@/lib/recruiterflow";

// DOCX mime types and filename suffixes we can extract text from via mammoth.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function looksLikeDocx(filename: string, mimeType: string): boolean {
  if (mimeType === DOCX_MIME) return true;
  return filename.toLowerCase().endsWith(".docx");
}

// Dynamic import so mammoth stays out of the edge bundle and Next's loader
// doesn't try to inline its runtime-require-based zip plumbing.
async function extractDocxText(data: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
  if (typeof extract !== "function") {
    throw new Error("DOCX parser failed to load. Try uploading as a PDF instead.");
  }
  const result = await extract({ buffer: data });
  return result.value ?? "";
}

// Strip any residual markdown Claude may emit even when instructed not to.
// Converts # / ## / ### headers into plain text, collapses **bold** and _italic_
// markers, and rewrites "- " / "* " bullet lines to use the • glyph.
export function stripMarkdownToPlain(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw;
    // Drop leading heading markers (## / ### / # etc).
    line = line.replace(/^\s{0,3}#{1,6}\s*/, "");
    // Convert "* text" / "- text" bullets to "• text" (leading whitespace preserved).
    line = line.replace(/^(\s*)[-*+]\s+/, "$1• ");
    // Drop **bold** / __bold__ wrappers while keeping inner text.
    line = line.replace(/\*\*(.+?)\*\*/g, "$1");
    line = line.replace(/__(.+?)__/g, "$1");
    // Drop single-* italic wrappers only when they look like pairs, not inside words.
    line = line.replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$|[.,;:!?)])/g, "$1$2");
    line = line.replace(/(^|\s)_(?!\s)(.+?)(?<!\s)_(?=\s|$|[.,;:!?)])/g, "$1$2");
    out.push(line);
  }
  // Collapse 3+ blank lines → 2 blanks.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Opus 4.7 per skill default. Sampling params (temperature/top_p/top_k) and
// budget_tokens are removed on 4.7 — do not re-add them.
export const CLAUDE_MODEL = "claude-opus-4-7";

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
      '  "notes": string|null\n' +
      "}\n\n" +
      "Rules:\n" +
      "- Use null (not empty string) for any field not present in the source.\n" +
      "- 'current_designation' is the candidate's present job title; 'current_organization' is their present employer. Use the most recent role listed.\n" +
      "- 'location' should be 'City, ST' if US, otherwise 'City, Country'.\n" +
      "- 'phone' keep the digits and country code as given; don't reformat.\n" +
      "- 'skills' is a short deduplicated array of 5–12 hard skills. Omit soft skills.\n" +
      "- 'linkedin_profile' is the full URL if one is present in the source. If only a LinkedIn URL was provided as input, echo it here.\n" +
      "- 'notes' is a short (2–4 sentence) summary of the candidate's experience highlights. Null if nothing notable.\n" +
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
    throw new Error("Claude didn't return valid JSON. Try again, or paste the profile text into the notes field manually.");
  }

  return {
    ...EMPTY_CANDIDATE,
    ...parsed,
    phone: normalizeToE164(parsed.phone),
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown): s is string => typeof s === "string") : [],
    linkedin_profile: parsed.linkedin_profile ?? linkedinUrl ?? null,
  };
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
// an anonymous BreakPoint-formatted JD in plain text with four sections.
// Output uses plain text only — no markdown symbols (no ##, no **, no -):
//
//   A Bit About Us
//   (paragraph)
//
//   Why Join Us
//   • bullet
//
//   Job Details
//
//   Key Responsibilities and Duties
//   • bullet
//
//   You Should Have Most of the Following
//   • bullet
//
// Section headers are on their own line, capitalized; bullets use the • glyph.
// The downstream renderer (ProseFromPlain) bolds headers and keeps bullets.
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
      "Reformat the source above into an anonymous BreakPoint Talent job description. " +
      "Strip any client name, logos, recruiter names, email addresses, and phone numbers." +
      titleHint +
      "\n\n" +
      "HARD FORMAT RULES — the grader rejects any output that violates these:\n" +
      "1. Plain text ONLY. No markdown anywhere.\n" +
      "2. No '#' characters. No '##'. No '###'. Section titles sit on their own line, unadorned.\n" +
      "3. No '**' anywhere. Not around headers, not around labels, nowhere.\n" +
      "4. Bullet lines start with the glyph '•' followed by a single space. Never '-'. Never '*'. Never '1.'.\n" +
      "5. One blank line between sections. No leading or trailing blank lines.\n\n" +
      "Produce EXACTLY this structure (the literal section titles below, nothing more, nothing less):\n\n" +
      "A Bit About Us\n" +
      "<2–4 sentence paragraph describing the company in generic terms — industry, size, stage, mission. Neutral phrasing like 'Our client is…' or 'The team is…'. No client name. No fabrication.>\n\n" +
      "Why Join Us\n" +
      "• <selling point>\n" +
      "• <selling point>\n" +
      "• <selling point>\n" +
      "• <selling point>\n" +
      "(4–6 total bullets — growth, team, mission, comp, culture, remote/hybrid, etc.)\n\n" +
      "Job Details\n\n" +
      "Key Responsibilities and Duties\n" +
      "• <verb-led responsibility>\n" +
      "• <verb-led responsibility>\n" +
      "• <verb-led responsibility>\n" +
      "(5–8 total bullets, concrete and day-to-day)\n\n" +
      "You Should Have Most of the Following\n" +
      "• <qualification / skill / experience>\n" +
      "• <qualification / skill / experience>\n" +
      "• <qualification / skill / experience>\n" +
      "(5–10 total bullets — hard requirements and preferred alike)\n\n" +
      "The words 'Job Details' appear alone on their own line; the only body under 'Job Details' is the two subsections. " +
      "Do NOT write a 'Job Details' paragraph or bullets beyond the two subsections. " +
      "Never mention 'BreakPoint' or 'the recruiter' in the body. Confident, concise recruiter voice.",
  });

  const system =
    "You turn client-supplied job descriptions into anonymous plain-text write-ups for BreakPoint Talent. " +
    "CRITICAL: output is plain text, never markdown. Never emit #, ##, **, or hyphen bullets. " +
    "Bullets always use the • glyph. Section titles sit on their own line, unadorned. " +
    "Every response must contain all four headers: 'A Bit About Us', 'Why Join Us', 'Job Details', " +
    "'Key Responsibilities and Duties', AND 'You Should Have Most of the Following'. " +
    "Stick to the structure the user specifies. Never fabricate facts.";

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
    return stripMarkdownToPlain(raw);
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
        "Please produce the full JD again with ALL required sections present, using plain text (no #, no **, no hyphen bullets — only • glyphs). " +
        "Keep the structure: A Bit About Us, Why Join Us, Job Details (containing Key Responsibilities and Duties AND You Should Have Most of the Following).",
    },
  ];
  const secondPass = await runOnce([
    { role: "user", content },
    { role: "assistant", content: firstPass },
    { role: "user", content: retryContent },
  ]);
  return secondPass || firstPass;
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
};

export async function generateSubmittalWriteup(input: SubmittalInput): Promise<string> {
  const anthropic = getClaude();
  const fullName = [input.candidate.firstName, input.candidate.lastName].filter(Boolean).join(" ") || "Candidate";

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
      "Plain text only — no markdown symbols, no asterisks, no hashes, no dashes for bullets. " +
      "Use the EXACT section headers the user specifies, on their own lines. " +
      "Confident, concise, recruiter voice. Never fabricate facts not in the source data. " +
      "Always tie the candidate's background to the specific role — this is a targeted pitch, not a generic summary.",
    messages: [
      {
        role: "user",
        content:
          `You are writing a candidate submittal for ${fullName} for the ${input.job.title} role at ${input.job.clientName || "the client"}. ` +
          "Write a targeted submittal email that makes the case for why THIS candidate fits THIS role — not a generic candidate summary. " +
          "Use the role context (title, location, employment type, salary range, experience range, description if present, custom fields) to frame the candidate. " +
          "In What He Brings and Technically, explicitly reference experience and skills from the candidate that align with what the role needs. " +
          "If there's a real mismatch (e.g. candidate's stack doesn't match), stay honest — don't manufacture fit.\n\n" +
          "Output must use this EXACT plain-text structure (no markdown, no asterisks, no hashes, no bullet dashes):\n\n" +
          `About ${fullName}\n` +
          "<2–4 sentence paragraph introducing the candidate — who they are, where they are now, and why they're on the market or interested in this specific role>\n\n" +
          "What He Brings\n" +
          "<3–5 sentences on the candidate's strengths and relevant experience FOR THIS ROLE — concrete, tying experience to what the role asks for>\n\n" +
          "Technically:\n" +
          "<2–4 sentences on hard skills / stack / tools / certifications, specifically the ones that match what the role needs>\n\n" +
          "Comp Target:\n" +
          "<one line — expected salary or range; if unknown, say 'Open / to be discussed'. If the role posts a range and the candidate's target falls inside it, say so.>\n\n" +
          "Location:\n" +
          "<one line — candidate's city/state + any remote/hybrid/on-site posture; note if it aligns with the role's location>\n\n" +
          "LinkedIn:\n" +
          "<one line — the LinkedIn URL, or 'Not provided'>\n\n" +
          "Rules:\n" +
          "- Use 'She' instead of 'He' in headers/pronouns when appropriate — infer from the name if possible, otherwise use 'they'.\n" +
          "- Do NOT include a 'Dear …' greeting or a sign-off — the recruiter's email signature handles those.\n" +
          "- Do NOT write 'Let me know if you'd like to set up an interview' — the caller appends that line.\n" +
          "- Never invent facts not in the source data. If a field is missing, omit or say so honestly.\n" +
          "- Do NOT paraphrase the whole job description — pull the parts that matter and tie them to the candidate.\n\n" +
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
  return stripMarkdownToPlain(text);
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
