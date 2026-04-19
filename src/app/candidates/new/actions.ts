"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseCandidateFields, type ParsedCandidate } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { fallbackParseCandidate } from "@/lib/resume-fallback";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user?.email);
}

async function getUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true },
  });
  return u?.id ?? null;
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

export type CreateCandidateInput = CreateCandidatePayload & {
  resumeUploadId?: string | null;
};

export type CreateCandidateResult =
  | { ok: true; value: { id: string } }
  | { ok: false; error: string; duplicate?: { id: string; name: string } };

// Hard rule (see MEMORY): creating a candidate in Ace writes to the local
// Neon Postgres database ONLY. No RecruiterFlow call, no background sync.
// If a resume was staged via /api/uploads/resume, its bytes are copied onto
// the Candidate row and the staging row is deleted.
export async function createCandidate(
  input: CreateCandidateInput,
): Promise<CreateCandidateResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const first = input.first_name.trim();
  if (!first) return { ok: false, error: "First name is required." };

  const email = input.email.trim().toLowerCase() || null;

  if (email) {
    const existing = await prisma.candidate.findUnique({
      where: { email },
      select: { id: true, firstName: true, lastName: true },
    });
    if (existing) {
      const name =
        [existing.firstName, existing.lastName].filter(Boolean).join(" ") ||
        "existing candidate";
      return {
        ok: false,
        error: "A candidate with this email already exists.",
        duplicate: { id: existing.id, name },
      };
    }
  }

  let resumeBytes: Uint8Array<ArrayBuffer> | null = null;
  let resumeMeta: { filename: string; mimeType: string; size: number } | null =
    null;
  if (input.resumeUploadId) {
    const row = await prisma.resumeUpload.findUnique({
      where: { id: input.resumeUploadId },
      select: { filename: true, mimeType: true, size: true, data: true, uploadComplete: true },
    });
    if (row && row.uploadComplete) {
      // Copy bytes into a fresh ArrayBuffer-backed Uint8Array so the Prisma
      // Bytes field doesn't trip on Buffer's widened ArrayBufferLike typing.
      const ab = new ArrayBuffer(row.data.byteLength);
      const copy = new Uint8Array(ab);
      copy.set(row.data);
      resumeBytes = copy;
      resumeMeta = {
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
      };
    }
  }

  try {
    const expRows = (input.experience ?? []).filter(
      (r) => r.designation.trim() || r.organization.trim(),
    );
    const eduRows = (input.education ?? []).filter(
      (r) => r.school.trim() || r.degree.trim(),
    );

    const created = await prisma.candidate.create({
      data: {
        firstName: first,
        lastName: input.last_name.trim() || null,
        email,
        phone: input.phone.trim() || null,
        currentDesignation: input.current_designation.trim() || null,
        currentOrganization: input.current_organization.trim() || null,
        location: input.location.trim() || null,
        linkedinProfile: input.linkedin_profile.trim() || null,
        skills: input.skills.filter(Boolean),
        notes: input.notes.trim() || null,
        experience: expRows.length ? expRows : undefined,
        education: eduRows.length ? eduRows : undefined,
        resumeFilename: resumeMeta?.filename ?? null,
        resumeMimeType: resumeMeta?.mimeType ?? null,
        resumeSize: resumeMeta?.size ?? null,
        resumeData: resumeBytes ?? null,
        resumeUploadedAt: resumeMeta ? new Date() : null,
        createdById: userId,
      },
      select: { id: true },
    });

    if (input.resumeUploadId) {
      await prisma.resumeUpload.deleteMany({ where: { id: input.resumeUploadId } });
    }

    revalidatePath("/candidates");
    revalidatePath(`/candidates/local/${created.id}`);
    return { ok: true, value: { id: created.id } };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[createCandidate] local save failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save candidate.",
    };
  }
}
