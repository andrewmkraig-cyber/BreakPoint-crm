"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { put } from "@vercel/blob";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { CLAUDE_MODEL, extractDocxText } from "@/lib/claude";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import { getResumeBytes } from "@/lib/resume-bytes";
import type {
  ResumeData,
  ResumeEducationEntry,
  ResumeExperienceEntry,
} from "@/app/candidates/[id]/resume-pdf-template";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

const anthropic = new Anthropic();

// Generate a fresh resume for a candidate from their Neon profile fields.
// Used by the empty-state "Generate Resume" button on the candidate
// profile when no resume is on file. Pulls the candidate's name, title,
// employer history, education, skills, comp, and recruiter notes; asks
// Claude (CLAUDE_MODEL = claude-sonnet-4-6) to write a clean plain-text
// resume; renders the response as PDF via pdf-lib using the same
// Helvetica + word-wrap + page-break loop convertDocxResumeToPdf uses;
// then writes the bytes to a new CandidateResume row keyed on
// candidateId/organizationId — same shape every other resume save uses.
//
// displayName is set to "AI Generated" so the version dropdown labels
// the row "AI Generated (Apr 30, 2026)" via dropdownLabelFor() in
// editable-resume.tsx. No `variant` is set — these are first-class
// originals once they exist; the recruiter can re-upload, brand, or
// redact them like any other resume.
export async function generateAiResume(input: {
  candidateId: string;
}): Promise<ActionResult<{ resumeId: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!input.candidateId) return { ok: false, error: "Missing candidate id." };

  try {
    const org = await getCurrentOrg();
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "Not signed in." };

    const candidate = await prisma.candidate.findFirst({
      where: { id: input.candidateId, organizationId: org.id },
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        currentDesignation: true,
        currentOrganization: true,
        location: true,
        linkedinProfile: true,
        skills: true,
        tags: true,
        expectedSalary: true,
        notes: true,
        experience: true,
        education: true,
        raw: true,
      },
    });
    if (!candidate) return { ok: false, error: "Candidate not found." };

    const fullName =
      [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim() ||
      "(no name on file)";

    // Build a structured user-message blob so Claude has every field at
    // hand. JSON-stringifying experience / education / raw passes the
    // structure through verbatim — the model is free to reorganize, but
    // never has to invent missing data.
    const profileBlob = {
      name: fullName,
      currentTitle: candidate.currentDesignation ?? null,
      currentEmployer: candidate.currentOrganization ?? null,
      location: candidate.location ?? null,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      linkedin: candidate.linkedinProfile ?? null,
      skills: candidate.skills ?? [],
      tags: candidate.tags ?? [],
      expectedSalary: candidate.expectedSalary ?? null,
      experience: candidate.experience ?? null,
      education: candidate.education ?? null,
      recruiterNotes: candidate.notes ?? null,
      // Legacy RF blob is included raw so any imported field that isn't
      // promoted to a top-level column (e.g. summary, certifications)
      // still feeds the resume.
      rfRaw: candidate.raw ?? null,
    };

    // Ask Claude for a structured JSON document instead of free prose
    // so the @react-pdf template can render each section in the right
    // slot. Strict-JSON output is more reliable than parsing prose;
    // we still strip a stray ```json fence in stripJsonFences below
    // for the rare turn where the model wraps it.
    const systemPrompt = [
      "You are a professional resume writer for a recruiting agency.",
      "From the candidate data, produce a clean professional resume as STRICT JSON only. No commentary, no markdown, no fences.",
      "Schema:",
      "{",
      '  "name": string,',
      '  "title": string,                       // current job title or target role',
      '  "contact": { "email"?: string, "phone"?: string, "location"?: string, "linkedin"?: string },',
      '  "summary"?: string,                    // 2-4 sentence professional summary',
      '  "experience": [{',
      '    "title": string, "company": string, "dates": string, "location"?: string,',
      '    "bullets": string[]                  // 2-4 bullets, each one impact-focused sentence',
      "  }],",
      '  "education": [{ "degree": string, "school": string, "year"?: string, "details"?: string }],',
      '  "skills": string[],                    // 8-15 short skill phrases',
      '  "certifications": string[]             // omit / empty if none in source data',
      "}",
      "Hard rules:",
      "- Do NOT invent facts. If a field is missing in the source, omit it from the output.",
      "- Output ONLY the JSON document. No explanation, no fences, no extra text.",
      "- Bullets are concise and start with a strong verb. Never include the candidate's name in a bullet.",
      "- If the candidate has no work experience in the source data, return an empty experience array.",
    ].join("\n");

    const userMessage = [
      "Candidate data (source-of-truth JSON):",
      JSON.stringify(profileBlob, null, 2),
      "",
      "Return the resume JSON now.",
    ].join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // No tools: array — resume formatting doesn't need web search and
    // we don't want the model to invent facts via a stray search.
    const rawText = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    if (!rawText) {
      return { ok: false, error: "Claude returned no resume content." };
    }

    const resumeData = parseResumeJson(rawText, fullName, candidate);
    if (!resumeData) {
      return {
        ok: false,
        error: "Couldn't parse resume JSON from Claude. Try again.",
      };
    }

    const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_") || "resume";
    const resumeId = await renderResumeDataToVersion({
      candidateId: candidate.id,
      candidateRfId: candidate.rfId,
      organizationId: org.id,
      userId: user.id,
      resumeData,
      displayName: "AI Generated",
      filename: `${safeName}_AI_Generated.pdf`,
      blobPath: `resumes/${candidate.id}/generated-${safeName}_AI_Generated.pdf`,
    });

    return { ok: true, value: { resumeId } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to generate resume.",
    };
  }
}

// Shared render→upload→save tail used by BOTH generateAiResume and
// editResumeWithClaude so every AI resume goes through the SAME @react-pdf
// renderer (resume-pdf-template.tsx) and the SAME CandidateResume version
// save shape. Renders the ResumeData to PDF bytes (pure JS, no Chromium),
// uploads to Vercel Blob, and writes a NEW CandidateResume row (never
// overwrites an existing one). Returns the new row id. Revalidates the
// candidate profile so the version dropdown picks up the new entry.
async function renderResumeDataToVersion(params: {
  candidateId: string;
  candidateRfId: number | null;
  organizationId: string;
  userId: string;
  resumeData: ResumeData;
  displayName: string;
  filename: string;
  blobPath: string;
}): Promise<string> {
  const { pdf } = await import("@react-pdf/renderer");
  const { ResumeDocument } = await import(
    "@/app/candidates/[id]/resume-pdf-template"
  );
  // Calling the component as a plain function returns the <Document>
  // element directly, which is what pdf() wants. @react-pdf/renderer v4's
  // toBuffer() returns a Node ReadableStream — drain into chunks and concat
  // into one Buffer before converting to the Uint8Array Prisma's Bytes
  // column expects.
  const pdfDoc = pdf(ResumeDocument({ data: params.resumeData }));
  const stream = await pdfDoc.toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const outputBytes = new Uint8Array(Buffer.concat(chunks));

  const blob = await put(params.blobPath, Buffer.from(outputBytes), {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: true,
  });

  const created = await prisma.candidateResume.create({
    data: {
      candidateId: params.candidateId,
      candidateRfId: params.candidateRfId,
      organizationId: params.organizationId,
      filename: params.filename,
      // displayName drives the version dropdown label via dropdownLabelFor().
      displayName: params.displayName,
      mimeType: "application/pdf",
      size: outputBytes.byteLength,
      data: Buffer.alloc(0),
      blobUrl: blob.url,
      uploadComplete: true,
      uploadedById: params.userId,
    },
    select: { id: true },
  });

  revalidatePath(`/candidates/${params.candidateId}`);
  if (params.candidateRfId != null) revalidatePath(`/candidates/${params.candidateRfId}`);

  return created.id;
}

// Today's date as "Mon D, YYYY" for the Edited version's display name.
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Server-side PDF text extraction. Uses the LEGACY pdfjs-dist build, the
// same proven Node path src/lib/resume-redactor/redact-pdf.ts already runs
// on uploaded resumes. We do NOT use pdf-parse here: pdf-parse@2 is a
// class-based rewrite backed by the non-legacy pdfjs bundle, which needs
// browser globals (DOMMatrix) that don't exist in the server action
// runtime — that's the "DOMMatrix is not defined" failure this replaces.
// The legacy build self-polyfills those globals and runs headless (no
// worker, no DOM). Text is reassembled line-by-line off each item's
// baseline y so the result keeps the resume's line breaks for Claude.
async function extractPdfTextNode(bytes: Buffer): Promise<string> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (args: {
      data: Uint8Array;
      useSystemFonts?: boolean;
      disableFontFace?: boolean;
      isEvalSupported?: boolean;
    }) => { promise: Promise<PdfJsDoc> };
  };
  // Copy into a fresh Uint8Array — pdfjs may take ownership of the buffer.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const parts: string[] = [];
    let lastY: number | null = null;
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[] };
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5] ?? null;
      // New line whenever the baseline moves vertically by more than a hair.
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        parts.push("\n");
      }
      parts.push(item.str);
      lastY = y;
    }
    text += parts.join("") + "\n";
    if (typeof page.cleanup === "function") page.cleanup();
  }
  if (typeof doc.cleanup === "function") doc.cleanup();
  return text.replace(/[ \t]+\n/g, "\n");
}

type PdfJsDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: (opts: { includeMarkedContent: boolean }) => Promise<{
      items: Array<unknown>;
    }>;
    cleanup?: () => void;
  }>;
  cleanup?: () => void;
};

// Extracts plain text from a candidate's current (most-recent) resume,
// reusing the app's existing extraction: the legacy pdfjs Node build for
// PDFs (see extractPdfTextNode) and extractDocxText for Word docs. Returns
// "" when there's no resume or the text can't be read; the caller turns
// that into a user-facing error.
async function extractCurrentResumeText(
  candidateId: string,
  organizationId: string,
): Promise<string> {
  const resume = await prisma.candidateResume.findFirst({
    where: { candidateId, organizationId, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
    select: { data: true, blobUrl: true, mimeType: true, filename: true },
  });
  if (!resume) return "";
  if (!resume.blobUrl && (!resume.data || resume.data.byteLength === 0)) return "";

  const mime = (resume.mimeType ?? "").toLowerCase();
  const name = (resume.filename ?? "").toLowerCase();
  const bytes = await getResumeBytes(resume);

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return (await extractPdfTextNode(bytes)).trim();
  }
  if (
    mime.includes("officedocument.wordprocessingml") ||
    mime === "application/msword" ||
    name.endsWith(".docx") ||
    name.endsWith(".doc")
  ) {
    return (await extractDocxText(bytes)).trim();
  }
  if (mime.startsWith("text/") || name.endsWith(".txt")) {
    return bytes.toString("utf-8").trim();
  }
  return "";
}

// Edit-with-Claude. Loads the candidate's current resume, extracts its
// text, and asks Claude to apply ONLY the requested change (everything
// else preserved verbatim), returning the full revised resume in the same
// structured JSON the generator uses. The result is rendered through the
// SAME @react-pdf template and saved as a NEW version named
// "Edited - <today>" — the original file is never touched.
export async function editResumeWithClaude(
  candidateId: string,
  instruction: string,
): Promise<ActionResult<{ resumeId: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!candidateId) return { ok: false, error: "Missing candidate id." };
  const trimmedInstruction = (instruction ?? "").trim();
  if (!trimmedInstruction) {
    return { ok: false, error: "Describe what you want changed first." };
  }

  try {
    const org = await getCurrentOrg();
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "Not signed in." };

    const candidate = await prisma.candidate.findFirst({
      where: { id: candidateId, organizationId: org.id },
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
        email: true,
        phone: true,
        location: true,
        linkedinProfile: true,
        skills: true,
      },
    });
    if (!candidate) return { ok: false, error: "Candidate not found." };

    const fullName =
      [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim() ||
      "(no name on file)";

    const resumeText = await extractCurrentResumeText(candidate.id, org.id);
    if (!resumeText) {
      return {
        ok: false,
        error:
          "Couldn't read the current resume's text to edit. Make sure a PDF, Word, or text resume is on file.",
      };
    }

    // Same JSON contract as the generator so the @react-pdf template can
    // render the result. The edit-specific rules pin Claude to the single
    // requested change and forbid touching anything else. Personal Trainer
    // rules are appended, matching every other Claude caller in Ace.
    const systemPrompt =
      [
        "You are a professional resume editor for a recruiting agency.",
        "You are given a candidate's CURRENT resume text and ONE editing instruction.",
        "Apply ONLY the requested change. Preserve every other piece of content verbatim — same wording, same bullets, same dates, same order. Do not rewrite, embellish, reorder, or drop anything the instruction did not ask you to change.",
        "Never invent facts. If the instruction asks for something the source can't support, make the smallest faithful change and leave the rest untouched.",
        "Return the FULL revised resume as STRICT JSON only. No commentary, no markdown, no fences.",
        "Schema:",
        "{",
        '  "name": string,',
        '  "title": string,',
        '  "contact": { "email"?: string, "phone"?: string, "location"?: string, "linkedin"?: string },',
        '  "summary"?: string,',
        '  "experience": [{ "title": string, "company": string, "dates": string, "location"?: string, "bullets": string[] }],',
        '  "education": [{ "degree": string, "school": string, "year"?: string, "details"?: string }],',
        '  "skills": string[],',
        '  "certifications": string[]',
        "}",
        "Output ONLY the JSON document.",
      ].join("\n") + (await buildPersonalTrainerBlock(org.id));

    const userMessage = [
      "CURRENT RESUME (source of truth — preserve verbatim except as instructed):",
      resumeText.slice(0, 24_000),
      "",
      `EDITING INSTRUCTION: ${trimmedInstruction}`,
      "",
      "Return the full revised resume JSON now.",
    ].join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (!rawText) return { ok: false, error: "Claude returned no resume content." };

    const resumeData = parseResumeJson(rawText, fullName, candidate);
    if (!resumeData) {
      return { ok: false, error: "Couldn't parse the revised resume from Claude. Try again." };
    }

    const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_") || "resume";
    const resumeId = await renderResumeDataToVersion({
      candidateId: candidate.id,
      candidateRfId: candidate.rfId,
      organizationId: org.id,
      userId: user.id,
      resumeData,
      displayName: `Edited - ${todayLabel()}`,
      filename: `${safeName}_Edited.pdf`,
      blobPath: `resumes/${candidate.id}/edited-${safeName}_Edited.pdf`,
    });

    return { ok: true, value: { resumeId } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to edit resume.",
    };
  }
}

// Strip accidental ```json … ``` fences and any leading prose so the
// JSON.parse call in parseResumeJson lands on a clean object literal.
// Claude usually returns clean JSON now, but the defensive strip lets
// the rare fenced response still parse instead of failing the whole
// generation.
function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    // Drop the opening fence line ("```json" or just "```").
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) s = s.slice(firstNewline + 1);
    // Drop the trailing fence.
    if (s.endsWith("```")) s = s.slice(0, -3);
  }
  // Some replies prefix with prose like "Here is the JSON:". Find the
  // first '{' and assume everything before it is preamble.
  const firstBrace = s.indexOf("{");
  if (firstBrace > 0) s = s.slice(firstBrace);
  // Same for trailing prose after the closing brace.
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < s.length - 1) {
    s = s.slice(0, lastBrace + 1);
  }
  return s.trim();
}

// Parse Claude's JSON output into a fully-populated ResumeData. Falls
// back to data we already have on the Candidate row when a field is
// missing or malformed, so the template never receives undefineds.
function parseResumeJson(
  rawText: string,
  fullName: string,
  candidate: {
    currentDesignation: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedinProfile: string | null;
    skills: string[];
  },
): ResumeData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const asString = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map(asString).filter((s) => s.length > 0)
      : [];

  const contactRaw = (obj.contact ?? {}) as Record<string, unknown>;
  const contact: ResumeData["contact"] = {
    email: asString(contactRaw.email) || candidate.email || undefined,
    phone: asString(contactRaw.phone) || candidate.phone || undefined,
    location: asString(contactRaw.location) || candidate.location || undefined,
    linkedin:
      asString(contactRaw.linkedin) ||
      candidate.linkedinProfile ||
      undefined,
  };

  const experience: ResumeExperienceEntry[] = Array.isArray(obj.experience)
    ? (obj.experience as unknown[]).flatMap<ResumeExperienceEntry>((row) => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const title = asString(r.title);
        const company = asString(r.company);
        if (!title && !company) return [];
        return [
          {
            title: title || "(role)",
            company: company || "(company)",
            dates: asString(r.dates),
            location: asString(r.location) || undefined,
            bullets: asStringArray(r.bullets),
          },
        ];
      })
    : [];

  const education: ResumeEducationEntry[] = Array.isArray(obj.education)
    ? (obj.education as unknown[]).flatMap<ResumeEducationEntry>((row) => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const degree = asString(r.degree);
        const school = asString(r.school);
        if (!degree && !school) return [];
        return [
          {
            degree: degree || "(degree)",
            school: school || "(school)",
            year: asString(r.year) || undefined,
            details: asString(r.details) || undefined,
          },
        ];
      })
    : [];

  return {
    name: asString(obj.name) || fullName,
    title: asString(obj.title) || candidate.currentDesignation || "",
    contact,
    summary: asString(obj.summary) || undefined,
    experience,
    education,
    skills: asStringArray(obj.skills).length > 0
      ? asStringArray(obj.skills)
      : candidate.skills,
    certifications: asStringArray(obj.certifications),
  };
}
