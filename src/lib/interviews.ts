import type { Interview, Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export type InterviewStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "rescheduled";

export type InterviewsForOrgOpts = {
  // Limit to one candidate (cuid).
  candidateId?: string;
  // Limit to one job. Accepts either a cuid (Ace-native) or a numeric
  // legacyRfId (RF-imported).
  jobIdentifier?: number | string;
  // Inclusive lower / exclusive upper bound on scheduledAt. Callers
  // pass JS Date instances.
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  // Status filter (["scheduled"], etc).
  statuses?: InterviewStatus[];
  // Order by scheduledAt — "asc" for upcoming feeds, "desc" for
  // history. Defaults to "asc".
  order?: "asc" | "desc";
};

// Lists Interviews for the signed-in tenant. All reads scope by
// organizationId. The dual-calendar-invite + shared-Meet creation /
// send-invite flow lives in src/app/candidates/[id]/interview-actions.ts
// (see commit a09162b) and is intentionally untouched — this helper is
// the read-side data layer underneath those UIs.
export async function getInterviewsForOrg(
  opts: InterviewsForOrgOpts = {},
): Promise<Interview[]> {
  const org = await getCurrentOrg();
  const where: Prisma.InterviewWhereInput = { organizationId: org.id };

  if (opts.candidateId) where.candidateId = opts.candidateId;

  if (opts.jobIdentifier !== undefined) {
    if (typeof opts.jobIdentifier === "number") {
      where.jobRfId = opts.jobIdentifier;
    } else {
      where.jobId = opts.jobIdentifier;
    }
  }

  if (opts.scheduledAfter || opts.scheduledBefore) {
    const range: Prisma.DateTimeFilter = {};
    if (opts.scheduledAfter) range.gte = opts.scheduledAfter;
    if (opts.scheduledBefore) range.lte = opts.scheduledBefore;
    where.scheduledAt = range;
  }

  if (opts.statuses && opts.statuses.length > 0) {
    where.status = { in: opts.statuses };
  }

  return prisma.interview.findMany({
    where,
    orderBy: { scheduledAt: opts.order ?? "asc" },
  });
}

// Resolves an Interview by its cuid primary key, scoped to the caller's
// tenant. Returns null (not throws) when the id doesn't belong to the
// caller's org so cross-tenant probes get a clean miss.
export async function getInterviewByIdentifier(
  id: string,
): Promise<Interview | null> {
  if (!id) return null;
  const org = await getCurrentOrg();
  return prisma.interview.findFirst({
    where: { id, organizationId: org.id },
  });
}
