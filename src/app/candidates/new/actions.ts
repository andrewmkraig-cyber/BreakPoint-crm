"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseCandidateFields, type ParsedCandidate } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { fallbackParseCandidate } from "@/lib/resume-fallback";
import { recruiterflow } from "@/lib/recruiterflow";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user?.email);
}

export type ParseSource = "claude" | "fallback";

export type ParseResumeResult = Result<{
  parsed: ParsedCandidate;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number;
  source: ParseSource;
  claudeError: string | null;
}>;

// Client chunked-uploads the resume first via /api/uploads/resume, then passes
// the resulting uploadId here. We read the assembled bytes from the
// ResumeUpload staging row, run the parser, and delete the staging row.
export async function parseCandidate(args: {
  resumeUploadId?: string | null;
  pastedText?: string;
  linkedinUrl?: string;
}): Promise<ParseResumeResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };

  const pastedText = (args.pastedText ?? "").trim();
  const linkedinUrl = (args.linkedinUrl ?? "").trim();
  const uploadId = args.resumeUploadId?.trim() || null;

  let resume: { filename: string; mimeType: string; data: Buffer } | undefined;
  let filename: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes = 0;

  if (uploadId) {
    const row = await prisma.resumeUpload.findUnique({
      where: { id: uploadId },
      select: { filename: true, mimeType: true, size: true, data: true, uploadComplete: true },
    });
    if (!row) return { ok: false, error: "Resume upload not found." };
    if (!row.uploadComplete) return { ok: false, error: "Resume upload not finished — try again." };
    resume = {
      filename: row.filename,
      mimeType: row.mimeType,
      data: Buffer.from(row.data),
    };
    filename = row.filename;
    mimeType = row.mimeType;
    sizeBytes = row.size;
  }

  if (!resume && !pastedText && !linkedinUrl) {
    return { ok: false, error: "Upload a resume, paste profile text, or enter a LinkedIn URL first." };
  }

  try {
    const parsed = await parseCandidateFields({ resume, pastedText, linkedinUrl });
    return {
      ok: true,
      value: { parsed, filename, mimeType, sizeBytes, source: "claude", claudeError: null },
    };
  } catch (claudeErr) {
    const claudeError = claudeErr instanceof Error ? claudeErr.message : "Claude parsing failed.";
    try {
      const parsed = await fallbackParseCandidate({ resume, pastedText, linkedinUrl });
      return {
        ok: true,
        value: { parsed, filename, mimeType, sizeBytes, source: "fallback", claudeError },
      };
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : "Fallback parse failed.";
      return { ok: false, error: `Claude: ${claudeError}. Fallback: ${fallbackMsg}` };
    }
  }
}

// Called after a candidate is saved so the staging resume row is cleaned up.
// No-op if the id is missing or already deleted.
export async function discardResumeUpload(uploadId: string | null | undefined): Promise<void> {
  if (!uploadId) return;
  await prisma.resumeUpload.deleteMany({ where: { id: uploadId } });
}

export type ParsedExperienceRow = {
  designation: string;
  organization: string;
  from_year: number | null;
  to_year: number | null;
  description: string;
};

export type ParsedEducationRow = {
  school: string;
  degree: string;
  from_year: number | null;
  to_year: number | null;
  description: string;
};

export type CreateCandidatePayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_designation: string;
  current_organization: string;
  location: string;
  linkedin_profile: string;
  skills: string[];
  notes: string;
  experience?: ParsedExperienceRow[];
  education?: ParsedEducationRow[];
};

export type CreateCandidateResult = Result<{ id: number }>;

export async function createCandidate(payload: CreateCandidatePayload): Promise<CreateCandidateResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };

  const first = payload.first_name.trim();
  if (!first) return { ok: false, error: "First name is required." };

  try {
    const created = await recruiterflow.createCandidate({
      first_name: first,
      last_name: payload.last_name.trim() || undefined,
      email: payload.email.trim() || undefined,
      phone_number: payload.phone.trim() || undefined,
      current_designation: payload.current_designation.trim() || undefined,
      current_organization: payload.current_organization.trim() || undefined,
      location: payload.location.trim() || undefined,
      linkedin_profile: payload.linkedin_profile.trim() || undefined,
      skills: payload.skills.filter(Boolean),
      notes: payload.notes.trim() || undefined,
      source_name: "Ace",
    });

    // /candidate/add doesn't accept nested experience/education arrays, so
    // push those through /candidate/update after the create. Best-effort —
    // if RF rejects the shape we still have the candidate saved.
    const expRows = (payload.experience ?? []).filter((r) => r.designation.trim() || r.organization.trim());
    const eduRows = (payload.education ?? []).filter((r) => r.school.trim() || r.degree.trim());
    if (expRows.length > 0 || eduRows.length > 0) {
      try {
        await recruiterflow.updateCandidate({
          id: created.id,
          experience: expRows.length
            ? expRows.map((r, i) => ({
                designation: r.designation.trim() || undefined,
                organization: r.organization.trim() || undefined,
                from: [null, r.from_year ?? null] as [number | null, number | null],
                to: [null, r.to_year ?? null] as [number | null, number | null],
                description: r.description.trim() || null,
                rank: i,
              }))
            : undefined,
          education: eduRows.length
            ? eduRows.map((r, i) => ({
                school: r.school.trim() || undefined,
                degree: r.degree.trim() || undefined,
                from: [null, r.from_year ?? null] as [number | null, number | null],
                to: [null, r.to_year ?? null] as [number | null, number | null],
                description: r.description.trim() || null,
                rank: i,
              }))
            : undefined,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[createCandidate] follow-up experience/education update failed:", e instanceof Error ? e.message : e);
      }
    }

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${created.id}`);
    return { ok: true, value: { id: created.id } };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[createCandidate] failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create candidate." };
  }
}
