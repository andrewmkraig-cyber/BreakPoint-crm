"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { parseCandidateFields, type ParsedCandidate } from "@/lib/claude";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { fallbackParseCandidate } from "@/lib/resume-fallback";
import { geocodePill } from "@/lib/geocode";

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
    if (!row.uploadComplete) return { ok: false, error: "Resume upload not finished. Try again." };
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

export type CheckCandidateEmailResult =
  | { ok: true; duplicate: { id: string; name: string } | null }
  | { ok: false; error: string };

// Used by the Create Candidate form onBlur to block submission early when the
// email already exists. Case-insensitive — we normalize to lowercase both on
// lookup and on create. Same unique constraint enforces this at the DB level.
export async function checkCandidateEmail(
  emailRaw: string,
): Promise<CheckCandidateEmailResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { ok: true, duplicate: null };
  const existing = await prisma.candidate.findUnique({
    where: { email },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!existing) return { ok: true, duplicate: null };
  const name =
    [existing.firstName, existing.lastName].filter(Boolean).join(" ") ||
    "existing candidate";
  return { ok: true, duplicate: { id: existing.id, name } };
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

    // Final safety-net backfill: if the form sent empty current title /
    // employer but the experience array has a "current" role (to_year null)
    // or any entry at all, derive from there. This is the third layer of
    // defense, on top of the prompt and the parser-output backfill — covers
    // races where the user clicks Save before the parsed values land in the
    // form state.
    const currentExp =
      expRows.find(
        (r) => r.to_year == null && (r.designation.trim() || r.organization.trim()),
      ) ??
      expRows[0] ??
      null;
    const dbDesignation =
      input.current_designation.trim() || currentExp?.designation.trim() || null;
    const dbOrganization =
      input.current_organization.trim() || currentExp?.organization.trim() || null;
    // eslint-disable-next-line no-console
    console.log("[createCandidate] payload arriving from form:", {
      first,
      last: input.last_name.trim() || null,
      email,
      current_designation_raw: input.current_designation,
      current_organization_raw: input.current_organization,
      dbDesignation,
      dbOrganization,
      experienceCount: expRows.length,
      educationCount: eduRows.length,
    });

    const org = await getCurrentOrg();
    const created = await prisma.candidate.create({
      data: {
        firstName: first,
        lastName: input.last_name.trim() || null,
        email,
        phone: input.phone.trim() || null,
        currentDesignation: dbDesignation,
        currentOrganization: dbOrganization,
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
        organizationId: org.id,
      },
      select: { id: true, currentDesignation: true, currentOrganization: true },
    });
    // eslint-disable-next-line no-console
    console.log("[createCandidate] DB write OK:", {
      id: created.id,
      currentDesignation: created.currentDesignation,
      currentOrganization: created.currentOrganization,
    });

    // Geocode the new candidate's location so the /pipeline + profile
    // distance sub-line works for them on the next render. This is now
    // AWAITED before the action returns: the previous detached
    // (non-awaited) promise was unreliable on Vercel serverless — the
    // function can suspend right after responding, killing the in-flight
    // geocode, so a new candidate's lat/lng would silently never land
    // (the Jordan Miller / Jordan Ellis null-coord bug). Awaiting closes
    // that race. A geocode MISS or failure must NEVER block or fail
    // candidate creation: geocodePill already swallows fetch errors /
    // 429 / timeout (5s AbortSignal) and returns null, and the inner
    // try/catch here also isolates a prisma.update throw so it can't
    // bubble to the outer create catch. On any miss the row keeps
    // lat/lng=null exactly as before and scripts/geocode-candidates.ts
    // remains the backfill safety net. Tenant-scoped on update (Rule 8).
    const candidateLocation = input.location.trim();
    if (candidateLocation) {
      try {
        const hit = await geocodePill(candidateLocation);
        if (hit) {
          await prisma.candidate.update({
            where: { id: created.id, organizationId: org.id },
            data: { lat: hit.lat, lng: hit.lng },
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[createCandidate] geocode failed (candidate still created)", {
          candidateId: created.id,
          location: candidateLocation,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Phase 5A.5.b: write a parallel CandidateResume row whenever the
    // create flow attaches a resume, so the multi-version dropdown +
    // rename + redact + brand work on Ace-native candidates without a
    // first-load backfill. The inline columns on Candidate stay
    // populated for legacy /api/local-candidate-resumes/[id] callers.
    if (resumeBytes && resumeMeta) {
      try {
        await prisma.candidateResume.create({
          data: {
            candidateId: created.id,
            // Ace-native rows have no RF id — column is nullable as of
            // Ace 20.0. The previous -Date.now() synthetic placeholder
            // overflowed PostgreSQL Int4 and 500'd the create.
            candidateRfId: null,
            organizationId: org.id,
            filename: resumeMeta.filename,
            mimeType: resumeMeta.mimeType,
            size: resumeMeta.size,
            data: resumeBytes,
            uploadComplete: true,
            uploadedById: userId,
          },
        });
      } catch (writeErr) {
        // Non-fatal: the inline copy on Candidate is still saved, and
        // local-profile.tsx lazy-backfills on view if this row is
        // missing. Log so we can spot a systemic issue if it ever fires.
        // eslint-disable-next-line no-console
        console.warn("[createCandidate] CandidateResume mirror failed:", writeErr);
      }
    }

    if (input.resumeUploadId) {
      await prisma.resumeUpload.deleteMany({ where: { id: input.resumeUploadId } });
    }

    // Phase 4c: audit-feed entry for the new candidate. Non-throwing;
    // a failed activity write never breaks the user's save.
    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "candidate_created",
      targetType: "candidate",
      targetId: created.id,
      metadata: {
        source: "manual",
        hasResume: Boolean(resumeMeta),
        hasEmail: Boolean(email),
      },
    });

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${created.id}`);
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
