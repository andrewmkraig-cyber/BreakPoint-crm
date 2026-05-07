import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Per-entity activity feed. Reads the canonical ActivityLog table and
// stitches together every row that touches the given candidate or client
// — directly (targetType matches the entity) or transitively through
// the placements / interviews that live under the entity. The polymorphic
// targetType/targetId column means a "candidate_applied_to_job" row
// targets the candidate while "interview_scheduled" targets the
// interview; the union below covers both shapes.
//
// Response shape is flat for the client renderer: each row carries the
// resolved candidateId/jobId/clientId pulled from metadata when present
// so the feed component can link back to the related entities without
// re-querying. Activities older than the entity's creation are rare but
// possible (e.g., a Placement created before a Candidate row in test
// fixtures); we don't filter by createdAt.

type EntityType = "candidate" | "client" | "job";

type ActivityRow = {
  id: string;
  actionType: string;
  description: string;
  createdAt: string;
  metadata: Prisma.JsonValue | null;
  candidateId: string | null;
  jobId: string | null;
  clientId: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { entityType: string; entityId: string } },
) {
  const entityType = params.entityType;
  const entityId = params.entityId;
  if (entityType !== "candidate" && entityType !== "client" && entityType !== "job") {
    return NextResponse.json({ error: "Unsupported entityType" }, { status: 400 });
  }
  if (!entityId) {
    return NextResponse.json({ error: "Missing entityId" }, { status: 400 });
  }

  const org = await getCurrentOrg();

  // Membership check — confirm the entity exists in this tenant before
  // returning anything. ActivityLog rows are organizationId-scoped by
  // construction, but the entity gate keeps a stranger from probing by
  // cuid for cross-tenant existence.
  let jobLegacyRfId: number | null = null;
  if (entityType === "candidate") {
    const exists = await prisma.candidate.findFirst({
      where: { id: entityId, organizationId: org.id },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ activities: [] });
  } else if (entityType === "client") {
    const exists = await prisma.client.findFirst({
      where: { id: entityId, organizationId: org.id },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ activities: [] });
  } else {
    const exists = await prisma.job.findFirst({
      where: { id: entityId, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!exists) return NextResponse.json({ activities: [] });
    jobLegacyRfId = exists.legacyRfId;
  }

  // Build the set of placement / interview ids that live under this
  // entity. Activities targeted at any of those ids belong to this
  // entity's feed. For clients we also pull placements/interviews
  // joined through Job (Job.clientId == entity) so a stage transition
  // logged against a placement still surfaces on the client's feed.
  // For jobs, placements/interviews can be matched by the cuid jobId
  // (Ace-native) OR the numeric jobRfId (RF-imported), so the OR
  // clause covers both identity shapes.
  let placementWhere: Prisma.PlacementWhereInput;
  let interviewWhere: Prisma.InterviewWhereInput;
  if (entityType === "candidate") {
    placementWhere = { candidateId: entityId, organizationId: org.id };
    interviewWhere = { candidateId: entityId, organizationId: org.id };
  } else if (entityType === "client") {
    placementWhere = {
      organizationId: org.id,
      OR: [{ clientId: entityId }, { job: { clientId: entityId } }],
    };
    interviewWhere = {
      organizationId: org.id,
      OR: [{ clientId: entityId }, { job: { clientId: entityId } }],
    };
  } else {
    const jobMatch: Prisma.PlacementWhereInput["OR"] = [{ jobId: entityId }];
    if (jobLegacyRfId != null) jobMatch.push({ jobRfId: jobLegacyRfId });
    placementWhere = { organizationId: org.id, OR: jobMatch };
    const interviewMatch: Prisma.InterviewWhereInput["OR"] = [{ jobId: entityId }];
    if (jobLegacyRfId != null) interviewMatch.push({ jobRfId: jobLegacyRfId });
    interviewWhere = { organizationId: org.id, OR: interviewMatch };
  }

  const [placementIds, interviewIds] = await Promise.all([
    prisma.placement.findMany({ where: placementWhere, select: { id: true } }),
    prisma.interview.findMany({ where: interviewWhere, select: { id: true } }),
  ]);

  const placementIdList = placementIds.map((p) => p.id);
  const interviewIdList = interviewIds.map((i) => i.id);

  // Union of every targetType+targetId pair this feed cares about. The
  // direct match handles candidate_created / candidate_applied_to_job
  // (targetType="candidate") and the future client_* writes; the two
  // IN clauses handle every action logged against a child placement or
  // interview.
  const orClauses: Prisma.ActivityLogWhereInput[] = [
    { targetType: entityType, targetId: entityId },
  ];
  if (placementIdList.length > 0) {
    orClauses.push({ targetType: "placement", targetId: { in: placementIdList } });
  }
  if (interviewIdList.length > 0) {
    orClauses.push({ targetType: "interview", targetId: { in: interviewIdList } });
  }

  const rows = await prisma.activityLog.findMany({
    where: { organizationId: org.id, OR: orClauses },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: {
      id: true,
      actionType: true,
      timestamp: true,
      metadata: true,
      targetType: true,
      targetId: true,
    },
  });

  const activities: ActivityRow[] = rows.map((r) => {
    const meta = (r.metadata ?? null) as Record<string, unknown> | null;
    const ids = resolveIds(r.targetType, r.targetId, entityType, entityId, meta);
    return {
      id: r.id,
      actionType: r.actionType,
      description: describeAction(r.actionType, meta),
      createdAt: r.timestamp.toISOString(),
      metadata: r.metadata,
      candidateId: ids.candidateId,
      jobId: ids.jobId,
      clientId: ids.clientId,
    };
  });

  return NextResponse.json({ activities });
}

function readString(meta: Record<string, unknown> | null, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function resolveIds(
  targetType: string,
  targetId: string,
  entityType: EntityType,
  entityId: string,
  meta: Record<string, unknown> | null,
): { candidateId: string | null; jobId: string | null; clientId: string | null } {
  // Start from metadata (writers reliably stash candidateId / jobId /
  // clientId there as cuids), then layer the targetType-derived id on
  // top so the field matching the row's primary subject is always
  // populated even when metadata omitted it.
  let candidateId = readString(meta, "candidateId");
  const jobId = readString(meta, "jobId");
  let clientId = readString(meta, "clientId");

  let resolvedJobId = jobId;
  if (targetType === "candidate") {
    candidateId = candidateId ?? targetId;
  } else if (targetType === "client") {
    clientId = clientId ?? targetId;
  } else if (targetType === "job") {
    resolvedJobId = resolvedJobId ?? targetId;
  }

  // If the request scope is the entity itself and the row didn't
  // expose its id any other way, anchor it. Keeps the response
  // shape consistent: candidate-feed rows always carry candidateId.
  if (entityType === "candidate") candidateId = candidateId ?? entityId;
  else if (entityType === "client") clientId = clientId ?? entityId;
  else if (entityType === "job") resolvedJobId = resolvedJobId ?? entityId;

  return { candidateId, jobId: resolvedJobId, clientId };
}

// Plain-English renderer for the activity feed. Falls back to a
// titleized actionType when we don't have a dedicated phrase yet so
// new actionTypes still show something readable instead of a raw
// snake_case token.
function describeAction(actionType: string, meta: Record<string, unknown> | null): string {
  const jobTitle = readString(meta, "jobTitle");
  const clientName = readString(meta, "clientName");
  const recipient = readString(meta, "recipientEmail");
  const subject = readString(meta, "subject");
  const kind = readString(meta, "kind");
  const reason = readString(meta, "reason");

  switch (actionType) {
    case "candidate_created":
      return "Candidate created";
    case "candidate_applied_to_job": {
      const at = clientName ? ` at ${clientName}` : "";
      return `Applied to ${jobTitle ?? "a job"}${at}`;
    }
    case "submittal_sent": {
      const forJob = jobTitle ? ` for ${jobTitle}` : "";
      return `Submitted${clientName ? ` to ${clientName}` : ""}${forJob}`;
    }
    case "offer_extended":
      return `Offer extended${jobTitle ? ` for ${jobTitle}` : ""}`;
    case "placement_confirmed":
      return "Placement confirmed";
    case "interview_scheduled":
      return `Interview scheduled${jobTitle ? ` for ${jobTitle}` : ""}`;
    case "interview_cancelled":
      return "Interview cancelled";
    case "email_sent": {
      const head = kind === "interview_invite" ? "Interview invite sent" : "Email sent";
      const to = recipient ? ` to ${recipient}` : "";
      const subj = subject ? ` — ${subject}` : "";
      return `${head}${to}${subj}`;
    }
    case "cancel_placement":
      return `Placement cancelled${reason ? ` — ${reason}` : ""}`;
    case "reject":
      return `Candidate rejected${reason ? ` — ${reason}` : ""}`;
    case "job_source_posting_saved": {
      const sourceUrl = readString(meta, "sourceUrl");
      const titleHead = jobTitle ?? "this job";
      return `Source posting saved: ${titleHead}${sourceUrl ? ` — ${sourceUrl}` : ""}`;
    }
    case "job_description_generated":
      return `Job description generated${jobTitle ? ` for ${jobTitle}` : ""}`;
    default:
      return titleize(actionType);
  }
}

function titleize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
