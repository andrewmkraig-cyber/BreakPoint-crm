"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { put } from "@vercel/blob";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { CLAUDE_MODEL } from "@/lib/claude";
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

    // ---- JSX → PDF via @react-pdf/renderer -----------------------------
    // pure-JS render, no Chromium. The template lives in
    // resume-pdf-template.tsx; this action just hands it the parsed
    // ResumeData and pulls the rendered bytes out as a Buffer.
    const { pdf } = await import("@react-pdf/renderer");
    const { ResumeDocument } = await import(
      "@/app/candidates/[id]/resume-pdf-template"
    );
    // Calling the component as a plain function returns the <Document>
    // element directly, which is what pdf() wants. createElement wraps
    // the result in a FunctionComponentElement that pdf()'s types don't
    // accept.
    //
    // @react-pdf/renderer v4 changed toBuffer() to return a Node
    // ReadableStream — we drain it into chunks and concat into a single
    // Buffer before converting to the Uint8Array Prisma's Bytes column
    // expects.
    const pdfDoc = pdf(ResumeDocument({ data: resumeData }));
    const stream = await pdfDoc.toBuffer();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const outputBytes = new Uint8Array(Buffer.concat(chunks));
    const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_");
    const filename = `${safeName || "resume"}_AI_Generated.pdf`;

    const blob = await put(
      `resumes/${candidate.id}/generated-${filename}`,
      Buffer.from(outputBytes),
      { access: "private", contentType: "application/pdf", addRandomSuffix: true },
    );

    const created = await prisma.candidateResume.create({
      data: {
        candidateId: candidate.id,
        candidateRfId: candidate.rfId,
        organizationId: org.id,
        filename,
        // displayName drives the version dropdown label via
        // dropdownLabelFor() in editable-resume.tsx.
        displayName: "AI Generated",
        mimeType: "application/pdf",
        size: outputBytes.byteLength,
        data: Buffer.alloc(0),
        blobUrl: blob.url,
        uploadComplete: true,
        uploadedById: user.id,
      },
      select: { id: true },
    });

    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);

    return { ok: true, value: { resumeId: created.id } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to generate resume.",
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
