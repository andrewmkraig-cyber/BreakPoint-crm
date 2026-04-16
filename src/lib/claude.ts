import Anthropic from "@anthropic-ai/sdk";

// Pinned to Sonnet 4 (2025-05-14) while we debug account-level billing on the
// Anthropic workspace. Swap back to "claude-opus-4-7" once credits are usable.
// Older model: do NOT pass `thinking: {type: "adaptive"}` or `output_config.effort` —
// those are 4.6+ only and will 400 here.
export const CLAUDE_MODEL = "claude-sonnet-4-20250514";

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
