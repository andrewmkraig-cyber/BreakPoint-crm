import type { JobBoardStatus, JobBoardStatusValue } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// Static catalog for the Promote tab. The 6 majors are seeded as
// JobBoardStatus rows on Job creation; the strings here drive the UI
// (account-needed indicator, default external URL placeholder) without
// needing a corresponding DB column. Adding a new major in the future:
// append to MAJOR_BOARDS, then bump existing rows on first read of
// Promote so they pick up the new entry (the lazy backfill below).
export type MajorBoardName =
  | "LinkedIn"
  | "Indeed"
  | "ZipRecruiter"
  | "Glassdoor"
  | "SimplyHired"
  | "Monster";

export type MajorBoardDef = {
  name: MajorBoardName;
  // True when posting to this board requires the recruiter to set up
  // an account / billing relationship first. Surfaces as the "Account
  // Needed" indicator on the row.
  accountNeeded: boolean;
  // Linked from the row when a recruiter doesn't have an external URL
  // saved yet — points at the board's job-poster home.
  posterHomeUrl: string;
};

export const MAJOR_BOARDS: MajorBoardDef[] = [
  { name: "LinkedIn", accountNeeded: true, posterHomeUrl: "https://www.linkedin.com/talent/post-a-job" },
  { name: "Indeed", accountNeeded: true, posterHomeUrl: "https://employers.indeed.com/p/post-a-job" },
  { name: "ZipRecruiter", accountNeeded: true, posterHomeUrl: "https://www.ziprecruiter.com/employer" },
  { name: "Glassdoor", accountNeeded: true, posterHomeUrl: "https://employers.glassdoor.com/post-a-job/" },
  { name: "SimplyHired", accountNeeded: false, posterHomeUrl: "https://www.simplyhired.com/employer" },
  { name: "Monster", accountNeeded: true, posterHomeUrl: "https://hiring.monster.com/" },
];

export const MAJOR_BOARD_NAMES: readonly MajorBoardName[] = MAJOR_BOARDS.map((b) => b.name);

// Status cycle for the chip click. Ordered so the recruiter taps from
// "haven't touched it yet" through to a terminal state and wraps.
export const STATUS_ORDER: JobBoardStatusValue[] = [
  "NOT_CONFIGURED",
  "READY",
  "POSTED",
  "SKIPPED",
];

export function nextStatusValue(current: JobBoardStatusValue): JobBoardStatusValue {
  const idx = STATUS_ORDER.indexOf(current);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

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
