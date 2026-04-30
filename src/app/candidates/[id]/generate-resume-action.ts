"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { CLAUDE_MODEL } from "@/lib/claude";

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

    const systemPrompt = [
      "You are a professional resume writer for a recruiting agency.",
      "Generate a clean, professional resume in plain text format from the candidate data provided.",
      "Use standard sections in this order: Name + contact line, Professional Summary, Experience, Education, Skills, Certifications (only if present in data).",
      "Each role under Experience should include: Job Title, Company, Dates, and 2-4 concise bullet points using hyphens.",
      "Use blank lines to separate sections. Use ALL CAPS for section headers (e.g. EXPERIENCE, EDUCATION, SKILLS).",
      "Do NOT use markdown syntax (no **bold**, no [links](url), no # headers).",
      "Do NOT invent facts. If a field is missing, omit it — never fill in placeholder text.",
      "Do NOT include any preamble, commentary, or sign-off — output only the resume content.",
      "Start the resume with the candidate's full name on its own line.",
    ].join("\n");

    const userMessage = [
      "Candidate data (JSON):",
      JSON.stringify(profileBlob, null, 2),
      "",
      "Write the resume.",
    ].join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // No tools: array — resume formatting doesn't need web search and
    // we don't want the model to invent facts via a stray search.
    const resumeText = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    if (!resumeText) {
      return { ok: false, error: "Claude returned no resume text." };
    }

    // ---- text → PDF ---------------------------------------------------
    // Mirrors the convertDocxResumeToPdf rendering loop in actions.ts:
    // Helvetica 11pt, 0.75" margins, manual word-wrap, page break when
    // y falls below the bottom margin. Non-WinAnsi characters fall back
    // to "?" so a stray emoji never 500s the whole render.
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const lineHeight = fontSize * 1.4;
    const margin = 54;
    const pageWidth = 612;
    const pageHeight = 792;
    const usableWidth = pageWidth - margin * 2;
    const black = rgb(0, 0, 0);

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin - fontSize;

    const ensureSpace = () => {
      if (y < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin - fontSize;
      }
    };

    const drawLine = (line: string) => {
      ensureSpace();
      const safe = line.replace(/[^\x00-\x7F]/g, (c) => {
        try {
          font.widthOfTextAtSize(c, fontSize);
          return c;
        } catch {
          return "?";
        }
      });
      page.drawText(safe, { x: margin, y, size: fontSize, font, color: black });
      y -= lineHeight;
    };

    const paragraphs = resumeText.replace(/\r\n/g, "\n").split(/\n+/);
    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        y -= lineHeight;
        continue;
      }
      const words = trimmed.split(/\s+/);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        let width: number;
        try {
          width = font.widthOfTextAtSize(candidate, fontSize);
        } catch {
          width = candidate.length * fontSize * 0.6;
        }
        if (width > usableWidth && line) {
          drawLine(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) drawLine(line);
      y -= lineHeight * 0.3;
    }

    const outputBytes = await pdf.save();
    const safeName = fullName.replace(/[^A-Za-z0-9_-]+/g, "_");
    const filename = `${safeName || "resume"}_AI_Generated.pdf`;

    const ab = new ArrayBuffer(outputBytes.byteLength);
    const data = new Uint8Array(ab);
    data.set(outputBytes);

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
        size: data.byteLength,
        data,
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
