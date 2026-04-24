"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
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
    await createActionLog({
      userId,
      actionType: "applicant_status",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: {
        jobRfId: input.jobRfId,
        status: input.status,
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
  // Phase 4b: jobRfId / clientRfId / jobId / clientId — RF-imported Jobs
  // pass numeric RF ids; Ace-native Jobs pass cuid FKs (jobId, clientId)
  // with jobRfId = null. Exactly one shape per call.
  jobRfId?: number | null;
  clientRfId?: number | null;
  jobId?: string | null;
  clientId?: string | null;
};

export async function keepCandidateForJob(input: KeepCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const jobRfId = input.jobRfId ?? null;
  const clientRfId = input.clientRfId ?? null;
  const jobId = input.jobId ?? null;
  const clientId = input.clientId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };
  try {
    const whereUnique = jobRfId != null
      ? { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId } }
      : null;
    if (whereUnique) {
      await prisma.placement.upsert({
        where: whereUnique,
        create: {
          candidateRfId: input.candidateRfId,
          jobRfId,
          jobId,
          clientRfId,
          clientId,
          stage: "kept",
          createdById: userId,
          organizationId: org.id,
          syncedToRf: false,
        },
        update: {
          stage: "kept",
          syncedToRf: false,
          invoicingFlagged: false,
        },
      });
    } else {
      // Ace-native job path: Placement has no candidateRfId+jobId unique
      // for RF candidates (only candidateId+jobId). Match by candidateRfId
      // + jobId via findFirst then upsert, or create fresh.
      const existing = await prisma.placement.findFirst({
        where: { candidateRfId: input.candidateRfId, jobId, organizationId: org.id },
        select: { id: true },
      });
      if (existing) {
        await prisma.placement.update({
          where: { id: existing.id },
          data: { stage: "kept", syncedToRf: false, invoicingFlagged: false },
        });
      } else {
        await prisma.placement.create({
          data: {
            candidateRfId: input.candidateRfId,
            jobRfId,
            jobId,
            clientRfId,
            clientId,
            stage: "kept",
            createdById: userId,
            organizationId: org.id,
            syncedToRf: false,
          },
        });
      }
    }
    await createActionLog({
      userId,
      actionType: "keep",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: { jobRfId, clientRfId, jobId, clientId },
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
  // Phase 4b: either jobRfId (RF-imported Job) or jobId (Ace-native cuid).
  jobRfId?: number | null;
  jobId?: string | null;
};

export async function removeKeptCandidate(input: RemoveKeptInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const jobRfId = input.jobRfId ?? null;
  const jobId = input.jobId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };
  try {
    // RF candidate + Ace job combo uses (candidateRfId, jobId) which
    // isn't a compound unique — findFirst then delete.
    const existing = jobRfId != null
      ? await prisma.placement.findUnique({
          where: {
            candidateRfId_jobRfId: {
              candidateRfId: input.candidateRfId,
              jobRfId,
            },
          },
          select: { id: true, stage: true },
        })
      : await prisma.placement.findFirst({
          where: { candidateRfId: input.candidateRfId, jobId },
          select: { id: true, stage: true },
        });
    if (!existing) return { ok: false, error: "Kept record not found." };
    if (existing.stage !== "kept") return { ok: false, error: "Not a kept placement." };
    await prisma.placement.delete({ where: { id: existing.id } });
    await createActionLog({
      userId,
      actionType: "remove_kept",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: { jobRfId, jobId },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

// ---- Ace-native variants ----
//
// Mirror the three RF-keyed actions above but target Placement by the
// candidateId (cuid) + jobRfId compound unique instead of candidateRfId +
// jobRfId. These exist so the /applicants row actions can Keep / Remove /
// Reject / (handoff) Submit on Ace-native candidates like Tyler Brennan
// without ever touching RF. Called from AppliedRowView / KeptRowView when
// the row's candidateId is a cuid string.

export type KeepLocalCandidateInput = {
  candidateId: string;
  // Phase 4b: either jobRfId (RF-imported Job) or jobId (Ace-native Job
  // cuid). Exactly one identity shape per call. clientId mirrors.
  jobRfId?: number | null;
  clientRfId?: number | null;
  jobId?: string | null;
  clientId?: string | null;
};

export async function keepLocalCandidateForJob(input: KeepLocalCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const jobRfId = input.jobRfId ?? null;
  const clientRfId = input.clientRfId ?? null;
  const jobId = input.jobId ?? null;
  const clientId = input.clientId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };
  try {
    const createData = {
      candidateId: input.candidateId,
      candidateRfId: null,
      jobRfId,
      jobId,
      clientRfId,
      clientId,
      stage: "kept",
      createdById: userId,
      organizationId: org.id,
      syncedToRf: false,
    } as const;
    if (jobId) {
      await prisma.placement.upsert({
        where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
        create: createData,
        update: { stage: "kept", syncedToRf: false, invoicingFlagged: false },
      });
    } else {
      await prisma.placement.upsert({
        where: {
          candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! },
        },
        create: createData,
        update: { stage: "kept", syncedToRf: false, invoicingFlagged: false },
      });
    }
    await createActionLog({
      userId,
      actionType: "keep",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { jobRfId, clientRfId, jobId, clientId, local: true },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Keep failed." };
  }
}

export type RemoveLocalKeptInput = {
  candidateId: string;
  // Phase 4b: either RF-imported Job (jobRfId) or Ace-native Job (jobId).
  jobRfId?: number | null;
  jobId?: string | null;
};

export async function removeLocalKeptCandidate(input: RemoveLocalKeptInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const jobRfId = input.jobRfId ?? null;
  const jobId = input.jobId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };
  try {
    const existing = jobId
      ? await prisma.placement.findUnique({
          where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
          select: { id: true, stage: true },
        })
      : await prisma.placement.findUnique({
          where: { candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! } },
          select: { id: true, stage: true },
        });
    if (!existing) return { ok: false, error: "Kept record not found." };
    if (existing.stage !== "kept") return { ok: false, error: "Not a kept placement." };
    await prisma.placement.delete({ where: { id: existing.id } });
    await createActionLog({
      userId,
      actionType: "remove_kept",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { jobRfId, jobId, local: true },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

export type RejectLocalCandidateInput = {
  candidateId: string;
  // Phase 4b: either RF-imported (jobRfId) or Ace-native (jobId cuid).
  jobRfId?: number | null;
  clientRfId?: number | null;
  jobId?: string | null;
  clientId?: string | null;
  previousStage: string | null;
  reason: string;
  detail?: string | null;
};

export async function rejectLocalCandidateJob(input: RejectLocalCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const jobRfId = input.jobRfId ?? null;
  const clientRfId = input.clientRfId ?? null;
  const jobId = input.jobId ?? null;
  const clientId = input.clientId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };
  try {
    const createData = {
      candidateId: input.candidateId,
      candidateRfId: null,
      jobRfId,
      jobId,
      clientRfId,
      clientId,
      stage: "rejected",
      createdById: userId,
      organizationId: org.id,
      syncedToRf: false,
    } as const;
    if (jobId) {
      await prisma.placement.upsert({
        where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
        create: createData,
        update: { stage: "rejected", syncedToRf: false },
      });
    } else {
      await prisma.placement.upsert({
        where: {
          candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! },
        },
        create: createData,
        update: { stage: "rejected", syncedToRf: false },
      });
    }
    await createActionLog({
      userId,
      actionType: "reject",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: {
        jobRfId,
        clientRfId,
        jobId,
        clientId,
        previousStage: input.previousStage,
        reason: input.reason,
        detail: input.detail ?? null,
        local: true,
      },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reject failed." };
  }
}
