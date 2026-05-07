import type { Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";

// Row shape rendered by the Pipeline tab on /jobs/[id]. Heavier than
// the JobPipelineRow used by the cross-tab chip strip — this one
// carries everything the table needs (location, days-in-stage, last
// action, and both candidate identity shapes for the Submit / Reject
// inline actions).
export type JobPipelineTabRow = {
  // Always-present cuid identity. Used for navigation and as the
  // candidateId in /api/placements POSTs (Reject button, etc.).
  candidateCuid: string;
  // Numeric rfId when the candidate was RF-imported, otherwise null.
  // Submit deep-links into /candidates/{rfId}?submit={jobRfId} when
  // both ids are present so the existing Submit modal opens directly
  // on the right job.
  candidateRfId: number | null;
  candidateName: string;
  candidateTitle: string | null;
  candidateLocation: string | null;
  stageName: string;
  bucket: PipelineBucket;
  // Whole days since the candidate landed on this stage. Floored, so
  // a candidate moved 23 hours ago renders as "0d". null when we have
  // no stageMovedAt to anchor on (legacy rows where the column was
  // back-filled to null).
  daysInStage: number | null;
  // The most recent ActivityLog row that touches this candidate's
  // Placement on this job. The label is rendered as-is — described
  // server-side so the client component stays a thin renderer.
  // Falls back to the placement's updatedAt when no ActivityLog row
  // exists for the placement.
  lastAction: {
    label: string;
    at: string; // ISO timestamp
  } | null;
};

export async function loadPipelineTabRows(args: {
  jobCuid: string;
  jobLegacyRfId: number | null;
}): Promise<JobPipelineTabRow[]> {
  const org = await getCurrentOrg();

  // Tenant-scoped placement load. Filter on either jobId (Ace-native
  // FK) OR jobRfId (RF-imported FK) so both identity shapes resolve
  // back to the same Job.
  const placementOr: Prisma.PlacementWhereInput["OR"] = [
    { jobId: args.jobCuid },
  ];
  if (args.jobLegacyRfId != null) placementOr.push({ jobRfId: args.jobLegacyRfId });

  const placements = await prisma.placement.findMany({
    where: { organizationId: org.id, OR: placementOr },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      candidateId: true,
      candidateRfId: true,
      stage: true,
      updatedAt: true,
    },
  });

  if (placements.length === 0) return [];

  const candidateCuids = Array.from(
    new Set(
      placements
        .map((p) => p.candidateId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const candidateRfIds = Array.from(
    new Set(
      placements
        .map((p) => p.candidateRfId)
        .filter((id): id is number => typeof id === "number"),
    ),
  );

  // One query covers both identity shapes. RF-imported candidates have
  // both id (cuid) and rfId; the OR clause guarantees we never miss
  // them when the Placement only carries candidateRfId.
  const candidateOr: Prisma.CandidateWhereInput["OR"] = [];
  if (candidateCuids.length > 0) candidateOr.push({ id: { in: candidateCuids } });
  if (candidateRfIds.length > 0) candidateOr.push({ rfId: { in: candidateRfIds } });
  const candidates =
    candidateOr.length > 0
      ? await prisma.candidate.findMany({
          where: { organizationId: org.id, OR: candidateOr },
          select: {
            id: true,
            rfId: true,
            firstName: true,
            lastName: true,
            currentDesignation: true,
            location: true,
          },
        })
      : [];

  const byCuid = new Map(candidates.map((c) => [c.id, c]));
  const byRfId = new Map(
    candidates.filter((c) => c.rfId != null).map((c) => [c.rfId as number, c]),
  );

  // Last-action lookup: most recent ActivityLog targeting each
  // placement. timestamp DESC + first-write-wins on insert into the
  // map gives us the freshest row per placement in a single pass.
  const placementIds = placements.map((p) => p.id);
  const activityRows = await prisma.activityLog.findMany({
    where: {
      organizationId: org.id,
      targetType: "placement",
      targetId: { in: placementIds },
    },
    orderBy: { timestamp: "desc" },
    take: 500,
    select: { actionType: true, metadata: true, timestamp: true, targetId: true },
  });
  const lastActivityByPlacement = new Map<
    string,
    { actionType: string; metadata: Prisma.JsonValue | null; timestamp: Date }
  >();
  for (const a of activityRows) {
    if (!lastActivityByPlacement.has(a.targetId)) {
      lastActivityByPlacement.set(a.targetId, a);
    }
  }

  const now = Date.now();
  const rows: JobPipelineTabRow[] = [];
  for (const p of placements) {
    const cand =
      (p.candidateId ? byCuid.get(p.candidateId) : undefined) ??
      (p.candidateRfId != null ? byRfId.get(p.candidateRfId) : undefined);
    if (!cand) continue; // Drop orphans rather than render an unlinkable row.

    const movedMs = p.updatedAt.getTime();
    const daysInStage = Number.isFinite(movedMs)
      ? Math.max(0, Math.floor((now - movedMs) / 86_400_000))
      : null;

    const recent = lastActivityByPlacement.get(p.id);
    const lastAction: JobPipelineTabRow["lastAction"] = recent
      ? {
          label: describePlacementActivity(recent.actionType, recent.metadata),
          at: recent.timestamp.toISOString(),
        }
      : { label: "Last updated", at: p.updatedAt.toISOString() };

    rows.push({
      candidateCuid: cand.id,
      candidateRfId: cand.rfId ?? null,
      candidateName:
        [cand.firstName, cand.lastName].filter(Boolean).join(" ").trim() || "(no name)",
      candidateTitle: cand.currentDesignation ?? null,
      candidateLocation: cand.location ?? null,
      stageName: p.stage,
      bucket: p.stage as PipelineBucket,
      daysInStage,
      lastAction,
    });
  }
  return rows;
}

// Plain-English label for the most recent placement-targeted activity.
// Mirrors the same naming the /api/activity feed uses so the two
// surfaces stay consistent. Falls back to a titleized actionType when
// we don't have a dedicated phrase yet.
function describePlacementActivity(
  actionType: string,
  metadata: Prisma.JsonValue | null,
): string {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  const reason = readString(meta, "reason");
  switch (actionType) {
    case "candidate_applied_to_job":
      return "Applied";
    case "submittal_sent":
      return "Submitted";
    case "interview_scheduled":
      return "Interview scheduled";
    case "interview_cancelled":
      return "Interview cancelled";
    case "offer_extended":
      return "Offer extended";
    case "placement_confirmed":
      return "Placement confirmed";
    case "cancel_placement":
      return reason ? `Placement cancelled: ${reason}` : "Placement cancelled";
    case "reject":
      return reason ? `Rejected: ${reason}` : "Rejected";
    default:
      return actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function readString(meta: Record<string, unknown> | null, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
