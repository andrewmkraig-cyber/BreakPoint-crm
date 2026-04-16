import Anthropic from "@anthropic-ai/sdk";

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
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system:
      "You extract key commercial terms from recruiting / placement fee agreements. You are precise and conservative — " +
      "you never invent numbers or clauses, and if a term isn't present you say 'Not specified.'",
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
              "Summarize the key terms of this placement / recruiting fee agreement. " +
              "Output a plain-text brief with bold-labeled sections (no markdown fences, no preamble, no trailing commentary). " +
              "Cover, in this order:\n\n" +
              "- Fee Percentage (of what base — first-year base salary? total comp? include formula if present)\n" +
              "- Guarantee / Replacement Period (number of days, replacement vs refund, pro-rata terms)\n" +
              "- Payment Terms (net-X days, invoice trigger — start date vs offer accepted, late-fee terms)\n" +
              "- Candidate Ownership / Exclusivity (ownership window in days, anti-poach scope, non-circumvention)\n" +
              "- Termination / Notice (notice period, termination rights)\n" +
              "- Governing Law / Jurisdiction (state, venue, arbitration clause)\n" +
              "- Other Notable Terms (liability caps, indemnification, confidentiality, background-check responsibility, anything else unusual)\n\n" +
              "For each section write 1–3 short lines. If a term isn't in the document, write 'Not specified.' — never guess. " +
              "Keep the whole summary under ~400 words.",
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
    } else {
      // Non-PDF: inline as text. Works for .txt, .md etc; skips binary Word docs.
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
      "Summarize the benefits info above into a clean brief a recruiter can share with a candidate. " +
      "Use short sections with bold labels and bulleted lines. Cover only the categories that are actually present: " +
      "Health / Dental / Vision (carrier, employee cost, tiers), Retirement / 401(k) (match, vesting), " +
      "PTO / Vacation / Sick / Holidays, Bonus / Equity / Commission, Remote / Hybrid policy, Stipends / Perks, " +
      "Eligibility / Waiting Period, and Anything else notable. Skip categories with no info — do not invent. " +
      "Keep it under ~350 words. Output plain text with line breaks (no markdown fences, no preamble, " +
      "no trailing commentary). If the source is unclear or mostly empty, say so in one line.",
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system:
      "You are an executive assistant for a recruiting firm. You turn messy benefits documents into a crisp candidate-facing brief. " +
      "Be factual — only summarize what's present. Never speculate about coverage levels that aren't stated.",
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned no summary text. Try again or adjust the inputs.");
  return text;
}
