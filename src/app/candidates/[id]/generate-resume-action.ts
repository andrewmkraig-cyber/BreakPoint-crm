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
import type {
  EditedResume,
  EditedResumeEntry,
  EditedResumeSection,
} from "@/app/candidates/[id]/edited-resume-template";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

const anthropic = new Anthropic();

type ResumeForEdit = {
  id: string;
  filename: string;
  displayName: string | null;
  variant: string | null;
  mimeType: string;
  data: Uint8Array | null;
  blobUrl: string | null;
};

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
      '    "bullets": string[]                  // 2-3 bullets, each one concise impact-focused sentence',
      "  }],",
      '  "education": [{ "degree": string, "school": string, "year"?: string, "details"?: string }],',
      '  "skills": string[],                    // 8-10 short skill phrases',
      '  "certifications": string[]             // omit / empty if none in source data',
      "}",
      "Hard rules:",
      "- Do NOT invent facts. If a field is missing in the source, omit it from the output.",
      "- Output ONLY the JSON document. No explanation, no fences, no extra text.",
      "- Keep the resume compact and recruiter-ready. Target one page for typical candidates.",
      "- Summary is 2 concise sentences maximum.",
      "- Return no more than 4 experience roles and no more than 3 bullets per role.",
      "- Return no more than 10 skills. Prefer the strongest role-relevant skills over a long list.",
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
      variant: "ai-generated",
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
  variant?: string;
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
      variant: params.variant,
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

// Render path for Edit Resume: the source-mirroring EditedResume model
// through the single-column EditedResumeDocument. Otherwise identical to
// renderResumeDataToVersion (drain the @react-pdf stream, upload to Blob,
// create a new CandidateResume version).
async function renderEditedResumeToVersion(params: {
  candidateId: string;
  candidateRfId: number | null;
  organizationId: string;
  userId: string;
  editedResume: EditedResume;
  displayName: string;
  variant?: string;
  filename: string;
  blobPath: string;
}): Promise<string> {
  const { pdf } = await import("@react-pdf/renderer");
  const { EditedResumeDocument } = await import(
    "@/app/candidates/[id]/edited-resume-template"
  );
  const pdfDoc = pdf(EditedResumeDocument({ data: params.editedResume }));
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
      displayName: params.displayName,
      variant: params.variant,
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
// The legacy build does NOT self-polyfill DOMMatrix; it relies on the
// optional native @napi-rs/canvas, which never loads in the Vercel lambda.
// So we install our own DOMMatrix + register the worker on the main thread
// (see ensurePdfNodeGlobals + the worker import below) before getDocument.
// Text is reassembled line-by-line off each item's baseline y so the result
// keeps the resume's line breaks for Claude.
async function extractPdfTextNode(bytes: Buffer): Promise<string> {
  // Install our pure-JS DOMMatrix BEFORE importing pdfjs. The legacy build
  // does `const SCALE_MATRIX = new DOMMatrix()` at module-eval and otherwise
  // depends on the native @napi-rs/canvas (which does not load in the Vercel
  // lambda) to define it. See src/lib/pdf-node-globals.ts.
  const { ensurePdfNodeGlobals } = await import("@/lib/pdf-node-globals");
  ensurePdfNodeGlobals();
  // Import the worker module so it sets globalThis.pdfjsWorker. pdfjs's Node
  // "fake worker" path otherwise does a dynamic import of GlobalWorkerOptions.
  // workerSrc ("./pdf.worker.mjs"), which is NOT traced into the Vercel lambda
  // -> "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs".
  // With globalThis.pdfjsWorker set, pdfjs uses the main-thread handler and
  // never resolves workerSrc; this explicit import also makes Next's file
  // tracing ship the worker into the bundle. See pdf-node-globals.ts.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
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
    let lastHeight = 11;
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[]; height?: number };
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5] ?? null;
      // pdfjs gives a per-item glyph height; fall back to the vertical scale
      // in the transform, then to the last height we saw. This is the unit we
      // judge line gaps against.
      const height =
        item.height && item.height > 1
          ? item.height
          : Math.abs(item.transform?.[3] ?? 0) || lastHeight;
      if (lastY !== null && y !== null) {
        const drop = lastY - y; // > 0 moving down the page (normal reading)
        const lineUnit = Math.max(lastHeight, height, 6);
        if (Math.abs(drop) <= 1.5) {
          // Same visual line — keep the run going (intra-line spaces already
          // come through as their own text items).
        } else if (drop > lineUnit * 1.8) {
          // A vertical jump much larger than one line is a blank line in the
          // source: a section break or a gap between entries. Preserve it so
          // Claude can SEE where sections start and end. Without this every
          // line is single-spaced and section boundaries vanish.
          parts.push("\n\n");
        } else {
          parts.push("\n");
        }
      }
      parts.push(item.str);
      lastY = y;
      lastHeight = height;
    }
    // A page boundary is itself a hard break.
    text += parts.join("") + "\n\n";
    if (typeof page.cleanup === "function") page.cleanup();
  }
  if (typeof doc.cleanup === "function") doc.cleanup();
  return text
    .replace(/[ \t]+\n/g, "\n") // trailing spaces before a newline
    .replace(/\n{3,}/g, "\n\n") // collapse runs of blanks to a single blank
    .trim();
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
async function loadResumeForEdit(
  candidateId: string,
  organizationId: string,
  resumeId?: string,
): Promise<ResumeForEdit | null> {
  const select = {
    id: true,
    filename: true,
    displayName: true,
    variant: true,
    data: true,
    blobUrl: true,
    mimeType: true,
  } as const;

  if (resumeId) {
    return prisma.candidateResume.findFirst({
      where: { id: resumeId, candidateId, organizationId, uploadComplete: true },
      select,
    });
  }

  return prisma.candidateResume.findFirst({
    where: { candidateId, organizationId, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
    select,
  });
}

async function extractResumeText(resume: ResumeForEdit): Promise<string> {
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

function isAiGeneratedResume(resume: ResumeForEdit): boolean {
  const label = `${resume.displayName ?? ""} ${resume.filename} ${resume.variant ?? ""}`.toLowerCase();
  return (
    label.includes("ai generated") ||
    label.includes("ai edited") ||
    label.includes("_ai_generated") ||
    label.includes("_ai_edited") ||
    resume.variant === "ai-generated" ||
    resume.variant === "ai-edited"
  );
}

function instructionRemovesLinkedIn(instruction: string): boolean {
  return /\b(remove|delete|omit|hide|take\s+out)\b[\s\S]*\blinked\s*in\b/i.test(instruction);
}

async function editGeneratedResumeDataWithClaude(params: {
  resumeText: string;
  instruction: string;
  fullName: string;
  orgId: string;
  candidate: {
    currentDesignation: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedinProfile: string | null;
    skills: string[];
  };
}): Promise<ResumeData | null> {
  const systemPrompt =
    [
      "You are a precise resume editor for an Ace-generated recruiting resume.",
      "The source resume was rendered from structured JSON using a fixed two-column PDF template.",
      "Apply ONLY the user's requested edit, then return the same structured resume JSON schema. Do not switch layouts.",
      "Preserve the resume's existing wording, section content, role order, education order, skill list, dates, numbers, and bullets unless the instruction explicitly changes them.",
      "Do not rewrite, expand, summarize, embellish, reorder, or add content. Do not make the resume longer unless the user explicitly asks for added content.",
      "If the instruction removes a contact item such as LinkedIn, remove only that field from contact and leave every other field unchanged.",
      "Keep the result compact and recruiter-ready. Target one page for typical candidates.",
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
      "Output ONLY the JSON document. No commentary, no markdown, no fences.",
    ].join("\n") + (await buildPersonalTrainerBlock(params.orgId));

  const userMessage = [
    "CURRENT ACE-GENERATED RESUME TEXT (source of truth):",
    params.resumeText.slice(0, 40_000),
    "",
    `EDITING INSTRUCTION: ${params.instruction}`,
    "",
    "Return the full revised structured resume JSON now. Apply only the requested edit.",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  if (!rawText) return null;

  const parsed = parseResumeJson(rawText, params.fullName, params.candidate);
  if (!parsed) return null;
  if (instructionRemovesLinkedIn(params.instruction)) {
    parsed.contact.linkedin = undefined;
  }
  return parsed;
}

// Edit-with-Claude. Loads the selected resume version, extracts its text, and
// applies ONLY the requested change. AI-generated resumes stay on the generated
// two-column template after editing; arbitrary uploaded resumes use the
// source-mirroring single-column editor.
export async function editResumeWithClaude(
  candidateId: string,
  instruction: string,
  sourceResumeId?: string,
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

    const sourceResume = await loadResumeForEdit(candidate.id, org.id, sourceResumeId);
    if (!sourceResume) {
      return {
        ok: false,
        error: sourceResumeId
          ? "Selected resume version not found."
          : "No resume version found for this candidate.",
      };
    }

    const resumeText = await extractResumeText(sourceResume);
    if (!resumeText) {
      return {
        ok: false,
        error:
          "Couldn't read the current resume's text to edit. Make sure a PDF, Word, or text resume is on file.",
      };
    }

    if (isAiGeneratedResume(sourceResume)) {
      const editedGeneratedResume = await editGeneratedResumeDataWithClaude({
        resumeText,
        instruction: trimmedInstruction,
        fullName,
        orgId: org.id,
        candidate,
      });
      if (!editedGeneratedResume) {
        return { ok: false, error: "Couldn't parse the revised resume from Claude. Try again." };
      }

      const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_") || "resume";
      const resumeId = await renderResumeDataToVersion({
        candidateId: candidate.id,
        candidateRfId: candidate.rfId,
        organizationId: org.id,
        userId: user.id,
        resumeData: editedGeneratedResume,
        displayName: `AI Edited - ${todayLabel()}`,
        variant: "ai-edited",
        filename: `${safeName}_AI_Edited.pdf`,
        blobPath: `resumes/${candidate.id}/edited-${safeName}_AI_Edited.pdf`,
      });

      return { ok: true, value: { resumeId } };
    }

    // The schema MIRRORS the source resume rather than forcing it into fixed
    // buckets: an ordered list of sections, each with its own heading and
    // generic entries. That is what lets Edit Resume keep the promise "apply
    // only the requested change, preserve everything else" — arbitrary
    // sections (Projects, Publications, Awards, Languages, ...) survive in
    // their original order instead of being dropped. Personal Trainer rules
    // are appended, matching every other Claude caller in Ace.
    const systemPrompt =
      [
        "You are a precise resume editor for a recruiting agency.",
        "You are given a candidate's CURRENT resume text and ONE editing instruction.",
        "Your job is to reproduce the resume EXACTLY, applying ONLY the requested change.",
        "Apply ONLY the requested change. Every other character — wording, bullets, dates, numbers, order — must be preserved verbatim. Do not rewrite, embellish, summarize, reorder, rename, merge, split, or drop anything the instruction did not explicitly ask you to change.",
        "Mirror the source structure 1:1: the SAME sections, in the SAME order, with the SAME headings; within each section the SAME entries in the SAME order; within each entry the SAME number of bullets, each bullet word-for-word.",
        "Never invent facts. If the instruction asks for something the source cannot support, make the smallest faithful change and leave everything else untouched.",
        "Return the FULL revised resume as STRICT JSON only. No commentary, no markdown, no fences.",
        "Schema:",
        "{",
        '  "name": string,                 // the person\'s name as written',
        '  "title"?: string,               // the role/tagline line under the name, ONLY if the source has one',
        '  "contact": string[],            // each contact line exactly as written (email, phone, location, links); [] if none',
        '  "sections": [                   // EVERY section of the source, in source order',
        '    {',
        '      "heading": string,          // the section heading exactly as written, e.g. "EXPERIENCE", "PROJECTS", "EDUCATION"',
        '      "entries": [                // the items under that heading, in source order',
        '        {',
        '          "primary"?: string,     // the item\'s bold lead line (job title, degree, project name), if any',
        '          "secondary"?: string,   // the item\'s second line (employer and location, school, issuer), if any',
        '          "meta"?: string,        // dates or year shown for the item, if any',
        '          "description"?: string, // a prose paragraph (e.g. a Summary, or an item overview), if any',
        '          "bullets"?: string[]    // bullet lines, each preserved word-for-word',
        '        }',
        '      ]',
        '    }',
        '  ]',
        "}",
        "Mapping guidance: a Summary/Objective/Profile section is one entry with only a description. A Skills/Languages/Interests list is one entry whose bullets are the listed items (one per bullet), unless the source writes it as prose (then use description). A job or degree is one entry using primary/secondary/meta/bullets. Keep each section's heading text exactly as the source wrote it.",
        "Output ONLY the JSON document.",
      ].join("\n") + (await buildPersonalTrainerBlock(org.id));

    const userMessage = [
      "CURRENT RESUME (source of truth — reproduce verbatim except for the instructed change; blank lines mark section/entry boundaries):",
      resumeText.slice(0, 40_000),
      "",
      `EDITING INSTRUCTION: ${trimmedInstruction}`,
      "",
      "Return the full revised resume JSON now, mirroring the source 1:1 with only the instructed change applied.",
    ].join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (!rawText) return { ok: false, error: "Claude returned no resume content." };

    const editedResume = parseEditedResumeJson(rawText, fullName);
    if (!editedResume) {
      return { ok: false, error: "Couldn't parse the revised resume from Claude. Try again." };
    }

    const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_") || "resume";
    const resumeId = await renderEditedResumeToVersion({
      candidateId: candidate.id,
      candidateRfId: candidate.rfId,
      organizationId: org.id,
      userId: user.id,
      editedResume,
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
            bullets: asStringArray(r.bullets).slice(0, 3),
          },
        ];
      }).slice(0, 4)
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
    summary: compactSummary(asString(obj.summary)) || undefined,
    experience,
    education,
    skills: asStringArray(obj.skills).length > 0
      ? asStringArray(obj.skills).slice(0, 10)
      : candidate.skills.slice(0, 10),
    certifications: asStringArray(obj.certifications).slice(0, 6),
  };
}

function compactSummary(summary: string): string {
  if (!summary) return "";
  const sentences = summary
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 2).join(" ").slice(0, 550).trim();
}

// Parse Claude's source-mirroring JSON into an EditedResume. Deliberately
// does NOT backfill from the Candidate row (name aside): injecting DB fields
// the source resume never had would add content the edit was supposed to
// preserve-only, breaking the "only the instructed change differs" contract.
// Empty entries and empty sections are dropped; field order/structure is left
// exactly as the model returned it.
function parseEditedResumeJson(
  rawText: string,
  fullName: string,
): EditedResume | null {
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
    Array.isArray(v) ? v.map(asString).filter((s) => s.length > 0) : [];

  const sections: EditedResumeSection[] = Array.isArray(obj.sections)
    ? (obj.sections as unknown[]).flatMap<EditedResumeSection>((row) => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const heading = asString(r.heading);
        const entries: EditedResumeEntry[] = Array.isArray(r.entries)
          ? (r.entries as unknown[]).flatMap<EditedResumeEntry>((e) => {
              if (!e || typeof e !== "object") return [];
              const er = e as Record<string, unknown>;
              const bullets = asStringArray(er.bullets);
              const entry: EditedResumeEntry = {
                primary: asString(er.primary) || undefined,
                secondary: asString(er.secondary) || undefined,
                meta: asString(er.meta) || undefined,
                description: asString(er.description) || undefined,
                bullets: bullets.length > 0 ? bullets : undefined,
              };
              const hasContent =
                entry.primary ||
                entry.secondary ||
                entry.meta ||
                entry.description ||
                entry.bullets;
              return hasContent ? [entry] : [];
            })
          : [];
        if (!heading && entries.length === 0) return [];
        return [{ heading, entries }];
      })
    : [];

  if (sections.length === 0) return null;

  return {
    name: asString(obj.name) || fullName,
    title: asString(obj.title) || undefined,
    contact: asStringArray(obj.contact),
    sections,
  };
}
