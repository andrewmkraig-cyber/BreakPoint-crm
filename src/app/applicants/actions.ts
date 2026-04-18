"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: s.user.email }, select: { id: true } });
  return u?.id ?? null;
}

export type ApplicantStatusValue = "new" | "reviewed" | "rejected" | "moved_to_pipeline";

export type SetApplicantStatusInput = {
  candidateRfId: number;
  jobRfId: number;
  status: ApplicantStatusValue;
};

const VALID: ReadonlySet<ApplicantStatusValue> = new Set<ApplicantStatusValue>([
  "new",
  "reviewed",
  "rejected",
  "moved_to_pipeline",
]);

// Applicants aren't their own Prisma model yet — we derive status from the
// latest `applicant_status` ActionLog row for the candidate/job pair. New
// applicants with no entry default to "new" on the page layer.
export async function setApplicantStatus(input: SetApplicantStatusInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!VALID.has(input.status)) return { ok: false, error: "Invalid status." };
  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "applicant_status",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          status: input.status,
        },
      },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update applicant." };
  }
}

// ---- Keep / Unkeep ----
//
// "Kept" is a per-(candidate, job) flag, stored as a Placement row with
// stage="kept". A recruiter keeps a candidate they like for a specific role
// but isn't ready to submit yet. From the Kept tab they can Submit (moves to
// Client Submission + deletes the kept row) or Remove (just deletes the row).
// Reject from the Applied tab is handled by the existing rejectCandidateJob.

export type KeepCandidateInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
};

export async function keepCandidateForJob(input: KeepCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    await prisma.placement.upsert({
      where: {
        candidateRfId_jobRfId: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
        },
      },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        stage: "kept",
        createdById: userId,
        syncedToRf: false,
      },
      update: {
        stage: "kept",
        syncedToRf: false,
        invoicingFlagged: false,
      },
    });
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "keep",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: { jobRfId: input.jobRfId, clientRfId: input.clientRfId },
      },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Keep failed." };
  }
}

export type RemoveKeptInput = {
  candidateRfId: number;
  jobRfId: number;
};

export async function removeKeptCandidate(input: RemoveKeptInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const existing = await prisma.placement.findUnique({
      where: {
        candidateRfId_jobRfId: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
        },
      },
      select: { id: true, stage: true },
    });
    if (!existing) return { ok: false, error: "Kept record not found." };
    if (existing.stage !== "kept") return { ok: false, error: "Not a kept placement." };
    await prisma.placement.delete({ where: { id: existing.id } });
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "remove_kept",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: { jobRfId: input.jobRfId },
      },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}
