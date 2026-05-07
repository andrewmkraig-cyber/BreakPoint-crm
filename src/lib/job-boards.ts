import type { JobBoardStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { MAJOR_BOARDS } from "@/lib/job-boards-shared";

// Server-only helpers for the JobBoardStatus table. Re-exports the
// client-safe constants from `@/lib/job-boards-shared` so callers that
// only need MAJOR_BOARDS / nextStatusValue can keep importing from
// here, but client components MUST import from `@/lib/job-boards-shared`
// directly — pulling this module into the client bundle drags
// PrismaClient with it.

export {
  MAJOR_BOARDS,
  MAJOR_BOARD_NAMES,
  STATUS_ORDER,
  nextStatusValue,
} from "@/lib/job-boards-shared";
export type {
  MajorBoardName,
  MajorBoardDef,
  JobBoardStatusValueShared,
} from "@/lib/job-boards-shared";

// Idempotent. Used both from createJob (one-shot at create time) and
// the Promote tab's first render for jobs that predate this table.
// Calls are safe to repeat — the @@unique([jobId, boardName]) makes
// `skipDuplicates` cover both fresh inserts and re-runs.
export async function ensureMajorBoardsSeeded(args: {
  jobId: string;
  organizationId: string;
}): Promise<void> {
  await prisma.jobBoardStatus.createMany({
    data: MAJOR_BOARDS.map((b) => ({
      jobId: args.jobId,
      organizationId: args.organizationId,
      boardName: b.name,
      category: "major",
    })),
    skipDuplicates: true,
  });
}

// Reads every JobBoardStatus row for a job in a deterministic order:
// majors first (in MAJOR_BOARDS order), then local/niche rows by
// updatedAt desc. Tenant-scoped — caller passes the resolved org id so
// this stays usable from server actions and API routes.
export async function listJobBoardStatuses(args: {
  jobId: string;
  organizationId: string;
}): Promise<JobBoardStatus[]> {
  const rows = await prisma.jobBoardStatus.findMany({
    where: { jobId: args.jobId, organizationId: args.organizationId },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
  });
  const majorByName = new Map<string, JobBoardStatus>();
  const others: JobBoardStatus[] = [];
  for (const r of rows) {
    if (r.category === "major") majorByName.set(r.boardName, r);
    else others.push(r);
  }
  const ordered: JobBoardStatus[] = [];
  for (const def of MAJOR_BOARDS) {
    const row = majorByName.get(def.name);
    if (row) ordered.push(row);
  }
  return [...ordered, ...others];
}
