"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import type { JobBoardStatusValue } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions for the Promote tab. Every action runs the same shape:
//   1. Confirm signed-in.
//   2. Resolve org + verify the target Job lives in this tenant.
//   3. Mutate.
//   4. Revalidate both URL shapes (RF-imported numeric + Ace-native cuid)
//      so a stale slug from another route still refreshes.

type Result = { ok: true } | { ok: false; error: string };

const STATUS_VALUES: JobBoardStatusValue[] = [
  "NOT_CONFIGURED",
  "READY",
  "POSTED",
  "SKIPPED",
];

function isValidStatus(s: string): s is JobBoardStatusValue {
  return (STATUS_VALUES as string[]).includes(s);
}

async function authorizeJob(jobId: string): Promise<
  | { ok: true; jobId: string; legacyRfId: number | null; organizationId: string }
  | { ok: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    select: { id: true, legacyRfId: true },
  });
  if (!job) return { ok: false, error: "Job not found." };
  return { ok: true, jobId: job.id, legacyRfId: job.legacyRfId, organizationId: org.id };
}

function revalidateBoth(jobId: string, legacyRfId: number | null) {
  revalidatePath(`/jobs/${jobId}`);
  if (legacyRfId != null) revalidatePath(`/jobs/${legacyRfId}`);
}

export async function updateJobBoardStatus(args: {
  jobId: string;
  rowId: string;
  status: string;
}): Promise<Result> {
  const auth = await authorizeJob(args.jobId);
  if (!auth.ok) return auth;
  if (!isValidStatus(args.status)) {
    return { ok: false, error: "Unknown status value." };
  }

  try {
    const updated = await prisma.jobBoardStatus.updateMany({
      where: {
        id: args.rowId,
        jobId: auth.jobId,
        organizationId: auth.organizationId,
      },
      data: { status: args.status },
    });
    if (updated.count === 0) return { ok: false, error: "Row not found." };
    revalidateBoth(auth.jobId, auth.legacyRfId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function updateJobBoardFields(args: {
  jobId: string;
  rowId: string;
  notes?: string | null;
  externalUrl?: string | null;
  boardName?: string;
}): Promise<Result> {
  const auth = await authorizeJob(args.jobId);
  if (!auth.ok) return auth;

  // Light validation: empty / blank boardName is rejected; URL must be
  // well-formed when present (the input field is type="url" so this is
  // belt-and-suspenders).
  if (args.boardName !== undefined) {
    const trimmed = args.boardName.trim();
    if (!trimmed) return { ok: false, error: "Board name can't be blank." };
    if (trimmed.length > 80) return { ok: false, error: "Board name too long." };
  }
  if (args.externalUrl !== undefined && args.externalUrl) {
    if (!/^https?:\/\//i.test(args.externalUrl.trim())) {
      return { ok: false, error: "URL must start with http:// or https://." };
    }
    if (args.externalUrl.length > 2000) {
      return { ok: false, error: "URL too long." };
    }
  }
  if (args.notes !== undefined && args.notes && args.notes.length > 4000) {
    return { ok: false, error: "Notes too long." };
  }

  const data: {
    notes?: string | null;
    externalUrl?: string | null;
    boardName?: string;
  } = {};
  if (args.notes !== undefined) data.notes = args.notes && args.notes.trim() ? args.notes : null;
  if (args.externalUrl !== undefined) {
    data.externalUrl = args.externalUrl && args.externalUrl.trim() ? args.externalUrl.trim() : null;
  }
  if (args.boardName !== undefined) data.boardName = args.boardName.trim();

  try {
    const updated = await prisma.jobBoardStatus.updateMany({
      where: {
        id: args.rowId,
        jobId: auth.jobId,
        organizationId: auth.organizationId,
      },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "Row not found." };
    revalidateBoth(auth.jobId, auth.legacyRfId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function addLocalNicheBoard(args: {
  jobId: string;
  boardName: string;
  externalUrl?: string;
  notes?: string;
  category?: string;
}): Promise<Result> {
  const auth = await authorizeJob(args.jobId);
  if (!auth.ok) return auth;

  const boardName = args.boardName.trim();
  if (!boardName) return { ok: false, error: "Board name is required." };
  if (boardName.length > 80) return { ok: false, error: "Board name too long." };

  const externalUrl = args.externalUrl?.trim() || null;
  if (externalUrl && !/^https?:\/\//i.test(externalUrl)) {
    return { ok: false, error: "URL must start with http:// or https://." };
  }

  try {
    // Reject duplicates against the @@unique([jobId, boardName]) — a
    // recruiter typing "LinkedIn" as a niche row would silently shadow
    // the seeded major otherwise.
    const existing = await prisma.jobBoardStatus.findUnique({
      where: { jobId_boardName: { jobId: auth.jobId, boardName } },
      select: { id: true },
    });
    if (existing) return { ok: false, error: "A row with that board name already exists." };

    await prisma.jobBoardStatus.create({
      data: {
        jobId: auth.jobId,
        organizationId: auth.organizationId,
        boardName,
        externalUrl,
        notes: args.notes?.trim() || null,
        category: (args.category?.trim() || "local_niche").toLowerCase(),
      },
    });
    revalidateBoth(auth.jobId, auth.legacyRfId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function removeJobBoard(args: {
  jobId: string;
  rowId: string;
}): Promise<Result> {
  const auth = await authorizeJob(args.jobId);
  if (!auth.ok) return auth;

  try {
    // Refuse to delete a major-board row — recruiters expect the 6
    // canonical boards to stay rendered. They can SKIPPED them instead.
    const row = await prisma.jobBoardStatus.findFirst({
      where: { id: args.rowId, jobId: auth.jobId, organizationId: auth.organizationId },
      select: { id: true, category: true },
    });
    if (!row) return { ok: false, error: "Row not found." };
    if (row.category === "major") {
      return {
        ok: false,
        error: "Major boards can't be removed. Set status to Skipped instead.",
      };
    }
    await prisma.jobBoardStatus.delete({ where: { id: row.id } });
    revalidateBoth(auth.jobId, auth.legacyRfId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
