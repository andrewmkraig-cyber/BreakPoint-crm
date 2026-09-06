import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { deleteCandidate as deleteCandidateAction } from "@/app/candidates/[id]/actions";
import { createReminder } from "@/app/calendar/reminder-actions";
import { parseReminderToolInput } from "@/lib/claude-panel/reminders";
import type { PlacementStage } from "@/lib/placements";
import { triggerJobsSiteRebuild } from "@/lib/jobs-site-rebuild";
import { decodeCommonHtmlEntities } from "@/lib/ai-output-formatting";

// Executes confirmed Claude Panel proposals. The chat route never
// runs writes itself — when Claude calls move_candidate_stage /
// add_note / draft_email, the panel renders a Confirm/Cancel card
// and POSTs here on Confirm. Cancel never reaches this route.
//
// Identifier policy: callers may send cuid OR legacy numeric rfId
// for candidate / client / job ids — search_candidates and friends
// surface whichever shape the row carries, so Claude often hands the
// numeric form back. Resolution is org-scoped, so a leaked id from
// another tenant 404s instead of mutating the wrong row.

export const dynamic = "force-dynamic";

const ALLOWED_STAGES: ReadonlyArray<PlacementStage> = [
  "sourced",
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "rejected",
  "cancelled",
];

function isAllowedStage(s: string): s is PlacementStage {
  return (ALLOWED_STAGES as ReadonlyArray<string>).includes(s);
}

async function resolveCandidate(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const rfId = Number(idOrRfId);
    if (!Number.isFinite(rfId)) return null;
    return prisma.candidate.findFirst({
      where: { rfId, organizationId: orgId },
      select: { id: true, rfId: true, firstName: true, lastName: true },
    });
  }
  return prisma.candidate.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, rfId: true, firstName: true, lastName: true },
  });
}

async function resolveClient(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const legacyRfId = Number(idOrRfId);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.client.findFirst({
      where: { legacyRfId, organizationId: orgId },
      select: { id: true, name: true },
    });
  }
  return prisma.client.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, name: true },
  });
}

async function resolveJob(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const legacyRfId = Number(idOrRfId);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.job.findFirst({
      where: { legacyRfId, organizationId: orgId },
      select: { id: true, title: true },
    });
  }
  return prisma.job.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, title: true },
  });
}

// Most-recent non-rejected, non-cancelled placement for a candidate.
// Used when Claude proposes a stage move without naming a specific
// placementId — typical for a recruiter saying "move Sara to
// interviewing" where there's only one live req in flight.
async function pickActivePlacement(candidateCuid: string, orgId: string) {
  return prisma.placement.findFirst({
    where: {
      candidateId: candidateCuid,
      organizationId: orgId,
      stage: { notIn: ["rejected", "cancelled"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stage: true,
      candidateRfId: true,
      job: { select: { title: true } },
      candidate: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  let body: { name?: unknown; input?: unknown; resolved?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name : "";
  const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<
    string,
    unknown
  >;
  // The chat route ships its server-resolved cuids alongside Claude's
  // raw input. Trust them when present — the lookup already happened
  // there and re-doing it here just multiplies failure modes. Falls
  // back to fresh resolution from `input` when missing.
  const resolved = (body.resolved && typeof body.resolved === "object"
    ? body.resolved
    : {}) as Record<string, unknown>;

  const org = await getCurrentOrg();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "User not found" },
      { status: 401 },
    );
  }

  if (name === "move_candidate_stage") {
    const candidateRef = typeof input.candidateId === "string" ? input.candidateId : "";
    const placementRef = typeof input.placementId === "string" ? input.placementId : "";
    const newStage = typeof input.newStage === "string" ? input.newStage : "";
    const preResolvedCandidateId =
      typeof resolved.candidateId === "string" ? resolved.candidateId : "";
    const preResolvedPlacementId =
      typeof resolved.placementId === "string" ? resolved.placementId : "";

    if (!candidateRef || !newStage) {
      return NextResponse.json(
        { ok: false, error: "candidateId and newStage are required" },
        { status: 400 },
      );
    }
    if (!isAllowedStage(newStage)) {
      return NextResponse.json(
        { ok: false, error: `newStage must be one of: ${ALLOWED_STAGES.join(", ")}` },
        { status: 400 },
      );
    }

    // Resolve the candidate (cuid or rfId). The pre-resolved cuid from
    // the chat route is preferred, but we re-verify it belongs to the
    // org so a forged client payload can't bypass the tenant guard.
    let candidate: { id: string; rfId: number | null; firstName: string | null; lastName: string | null } | null = null;
    if (preResolvedCandidateId) {
      candidate = await prisma.candidate.findFirst({
        where: { id: preResolvedCandidateId, organizationId: org.id },
        select: { id: true, rfId: true, firstName: true, lastName: true },
      });
    }
    if (!candidate) {
      candidate = await resolveCandidate(candidateRef, org.id);
    }
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "Candidate not found." },
        { status: 404 },
      );
    }

    // Resolve the placement: prefer the pre-resolved cuid (org-checked
    // again), fall back to whatever Claude passed (cuid only — we
    // don't accept rfId for placements; they're Ace-native), and
    // finally fall back to the candidate's most recent active
    // placement so a "move Sara to interviewing" with no placementId
    // still lands.
    let placement: {
      id: string;
      stage: string;
      candidateRfId: number | null;
      job: { title: string } | null;
      candidate: { firstName: string | null; lastName: string | null } | null;
    } | null = null;
    if (preResolvedPlacementId) {
      placement = await prisma.placement.findFirst({
        where: {
          id: preResolvedPlacementId,
          organizationId: org.id,
          candidateId: candidate.id,
        },
        select: {
          id: true,
          stage: true,
          candidateRfId: true,
          job: { select: { title: true } },
          candidate: { select: { firstName: true, lastName: true } },
        },
      });
    }
    if (!placement && placementRef) {
      placement = await prisma.placement.findFirst({
        where: {
          id: placementRef,
          organizationId: org.id,
          candidateId: candidate.id,
        },
        select: {
          id: true,
          stage: true,
          candidateRfId: true,
          job: { select: { title: true } },
          candidate: { select: { firstName: true, lastName: true } },
        },
      });
    }
    if (!placement) {
      placement = await pickActivePlacement(candidate.id, org.id);
    }
    if (!placement) {
      return NextResponse.json(
        { ok: false, error: "No active placement found for this candidate." },
        { status: 404 },
      );
    }

    const fromStage = placement.stage;
    await prisma.placement.update({
      where: { id: placement.id },
      data: { stage: newStage, syncedToRf: false },
    });
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "claude_move_stage",
      targetType: "placement",
      targetId: placement.id,
      metadata: {
        fromStage,
        toStage: newStage,
        candidateId: candidate.id,
        source: "claude_panel",
      },
    });
    revalidatePath("/pipeline");
    revalidatePath(`/candidates/${candidate.id}`);
    if (placement.candidateRfId) {
      revalidatePath(`/candidates/${placement.candidateRfId}`);
    }
    const candName =
      [placement.candidate?.firstName, placement.candidate?.lastName]
        .filter(Boolean)
        .join(" ") || "(unnamed)";
    const jobTitle = placement.job?.title ?? "(unknown job)";
    return NextResponse.json({
      ok: true,
      message: `Moved ${candName} from ${fromStage} → ${newStage} on ${jobTitle}.`,
    });
  }

  if (name === "add_note") {
    const entityType = typeof input.entityType === "string" ? input.entityType : "";
    const entityRef = typeof input.entityId === "string" ? input.entityId : "";
    const note = typeof input.note === "string" ? input.note.trim() : "";
    const preResolvedEntityId =
      typeof resolved.entityId === "string" ? resolved.entityId : "";

    if (!entityType || !entityRef || !note) {
      return NextResponse.json(
        { ok: false, error: "entityType, entityId, and note are required" },
        { status: 400 },
      );
    }
    if (entityType !== "candidate" && entityType !== "client" && entityType !== "job") {
      return NextResponse.json(
        { ok: false, error: "entityType must be candidate, client, or job" },
        { status: 400 },
      );
    }

    // Resolve the target. Pre-resolved cuid from the chat route is
    // verified against the org (defense in depth — never trust a
    // client-provided id without a fresh org-scoped lookup), then
    // falls back to the cuid-or-rfId resolver if the pre-resolved id
    // is missing or stale.
    let entityCuid: string | null = null;
    let entityName = "(unnamed)";

    if (entityType === "candidate") {
      let row: { id: string; firstName: string | null; lastName: string | null } | null = null;
      if (preResolvedEntityId) {
        row = await prisma.candidate.findFirst({
          where: { id: preResolvedEntityId, organizationId: org.id },
          select: { id: true, firstName: true, lastName: true },
        });
      }
      if (!row) {
        row = await resolveCandidate(entityRef, org.id);
      }
      if (!row) {
        return NextResponse.json(
          { ok: false, error: "Candidate not found." },
          { status: 404 },
        );
      }
      entityCuid = row.id;
      entityName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "(unnamed)";
    } else if (entityType === "client") {
      let row: { id: string; name: string } | null = null;
      if (preResolvedEntityId) {
        row = await prisma.client.findFirst({
          where: { id: preResolvedEntityId, organizationId: org.id },
          select: { id: true, name: true },
        });
      }
      if (!row) {
        row = await resolveClient(entityRef, org.id);
      }
      if (!row) {
        return NextResponse.json(
          { ok: false, error: "Client not found." },
          { status: 404 },
        );
      }
      entityCuid = row.id;
      entityName = row.name;
    } else {
      let row: { id: string; title: string } | null = null;
      if (preResolvedEntityId) {
        row = await prisma.job.findFirst({
          where: { id: preResolvedEntityId, organizationId: org.id },
          select: { id: true, title: true },
        });
      }
      if (!row) {
        row = await resolveJob(entityRef, org.id);
      }
      if (!row) {
        return NextResponse.json(
          { ok: false, error: "Job not found." },
          { status: 404 },
        );
      }
      entityCuid = row.id;
      entityName = row.title;
    }

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "note",
      targetType: entityType,
      targetId: entityCuid,
      metadata: { note, source: "claude_panel" },
    });
    revalidatePath(
      `/${entityType === "candidate" ? "candidates" : entityType === "client" ? "clients" : "jobs"}/${entityCuid}`,
    );
    return NextResponse.json({
      ok: true,
      message: `Note added to ${entityType} ${entityName}.`,
    });
  }

  if (name === "draft_email") {
    const to = typeof input.to === "string" ? input.to : "";
    const subject =
      typeof input.subject === "string" ? decodeCommonHtmlEntities(input.subject) : "";
    const emailBody =
      typeof input.body === "string" ? decodeCommonHtmlEntities(input.body) : "";
    if (!to || !subject) {
      return NextResponse.json(
        { ok: false, error: "to and subject are required" },
        { status: 400 },
      );
    }
    // Composer opens client-side. We just echo the params so the panel
    // can hand them to useComposerManager without re-validating.
    return NextResponse.json({
      ok: true,
      openComposer: true,
      to,
      subject,
      body: emailBody,
      message: `Mail composer opened: ${subject}`,
    });
  }

  if (name === "inactivate_job" || name === "privatize_job" || name === "reactivate_job") {
    const jobRef = typeof input.jobId === "string" ? input.jobId : "";
    const preResolvedJobId =
      typeof resolved.jobId === "string" ? resolved.jobId : "";
    if (!jobRef && !preResolvedJobId) {
      return NextResponse.json(
        { ok: false, error: "jobId is required" },
        { status: 400 },
      );
    }

    let job:
      | { id: string; legacyRfId: number | null; title: string; isOpen: boolean; lifecycle: string | null }
      | null = null;
    if (preResolvedJobId) {
      job = await prisma.job.findFirst({
        where: { id: preResolvedJobId, organizationId: org.id },
        select: {
          id: true,
          legacyRfId: true,
          title: true,
          isOpen: true,
          lifecycle: true,
        },
      });
    }
    if (!job && jobRef) {
      const fallback = await resolveJob(jobRef, org.id);
      if (fallback) {
        job = await prisma.job.findFirst({
          where: { id: fallback.id, organizationId: org.id },
          select: {
            id: true,
            legacyRfId: true,
            title: true,
            isOpen: true,
            lifecycle: true,
          },
        });
      }
    }
    if (!job) {
      return NextResponse.json(
        { ok: false, error: "Job not found." },
        { status: 404 },
      );
    }

    const target: "active" | "private" | "inactive" =
      name === "inactivate_job"
        ? "inactive"
        : name === "privatize_job"
          ? "private"
          : "active";
    const current: "active" | "private" | "inactive" =
      job.lifecycle === "private" || job.lifecycle === "inactive" || job.lifecycle === "active"
        ? job.lifecycle
        : job.isOpen
          ? "active"
          : "inactive";
    if (current === target) {
      return NextResponse.json({
        ok: true,
        message: `${job.title} is already ${target}.`,
      });
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        lifecycle: target,
        isOpen: target !== "inactive",
        ...(target === "active" ? {} : { publishToWebsite: false }),
      },
    });
    const actionType =
      target === "inactive"
        ? "job_inactivated"
        : target === "private"
          ? "job_made_private"
          : "job_reactivated";
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType,
      targetType: "job",
      targetId: job.id,
      metadata: {
        jobTitle: job.title,
        fromLifecycle: current,
        toLifecycle: target,
        source: "claude_panel",
      },
    });
    revalidatePath(`/jobs`);
    revalidatePath(`/jobs/${job.id}`);
    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/pipeline`);
    await triggerJobsSiteRebuild(`job-lifecycle-${target}`);
    const verb =
      target === "inactive"
        ? "Inactivated"
        : target === "private"
          ? "Moved to Private"
          : "Reactivated";
    return NextResponse.json({
      ok: true,
      message: `${verb} ${job.title}.`,
    });
  }

  if (name === "delete_job") {
    const jobRef = typeof input.jobId === "string" ? input.jobId : "";
    const preResolvedJobId =
      typeof resolved.jobId === "string" ? resolved.jobId : "";
    if (!jobRef && !preResolvedJobId) {
      return NextResponse.json(
        { ok: false, error: "jobId is required" },
        { status: 400 },
      );
    }

    let job: { id: string; legacyRfId: number | null; title: string; clientId: string | null } | null =
      null;
    if (preResolvedJobId) {
      job = await prisma.job.findFirst({
        where: { id: preResolvedJobId, organizationId: org.id },
        select: { id: true, legacyRfId: true, title: true, clientId: true },
      });
    }
    if (!job && jobRef) {
      const fallback = await resolveJob(jobRef, org.id);
      if (fallback) {
        job = await prisma.job.findFirst({
          where: { id: fallback.id, organizationId: org.id },
          select: { id: true, legacyRfId: true, title: true, clientId: true },
        });
      }
    }
    if (!job) {
      return NextResponse.json(
        { ok: false, error: "Job not found." },
        { status: 404 },
      );
    }

    // Activity log lands BEFORE the delete so the audit row survives
    // the cascade. ActivityLog.targetId is a polymorphic string FK
    // with no DB-level tie back to Job, so a deleted job doesn't take
    // its history with it.
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "job_deleted",
      targetType: "job",
      targetId: job.id,
      metadata: {
        jobTitle: job.title,
        clientId: job.clientId,
        legacyRfId: job.legacyRfId,
        source: "claude_panel",
      },
    });
    await prisma.job.delete({ where: { id: job.id } });

    revalidatePath(`/jobs`);
    revalidatePath(`/jobs/${job.id}`);
    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/pipeline`);
    if (job.clientId) revalidatePath(`/clients/${job.clientId}`);
    await triggerJobsSiteRebuild("job-deleted");

    return NextResponse.json({
      ok: true,
      message: `Deleted ${job.title}.`,
      redirect: "/jobs",
    });
  }

  if (name === "delete_candidate") {
    const candidateRef =
      typeof input.candidateId === "string" ? input.candidateId : "";
    const preResolvedCandidateId =
      typeof resolved.candidateId === "string" ? resolved.candidateId : "";
    if (!candidateRef && !preResolvedCandidateId) {
      return NextResponse.json(
        { ok: false, error: "candidateId is required" },
        { status: 400 },
      );
    }

    // Resolve to a cuid that belongs to this org. Pre-resolved id from
    // the chat route is preferred but re-verified — defense-in-depth
    // against a forged action POST. Falls back to the cuid-or-rfId
    // resolver when the pre-resolved id is missing or stale.
    let candidate:
      | { id: string; rfId: number | null; firstName: string | null; lastName: string | null }
      | null = null;
    if (preResolvedCandidateId) {
      candidate = await prisma.candidate.findFirst({
        where: { id: preResolvedCandidateId, organizationId: org.id },
        select: { id: true, rfId: true, firstName: true, lastName: true },
      });
    }
    if (!candidate && candidateRef) {
      candidate = await resolveCandidate(candidateRef, org.id);
    }
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "Candidate not found." },
        { status: 404 },
      );
    }

    const candName =
      [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
      "(unnamed)";

    // Reuses the same cascading transaction the user-facing delete
    // button calls — wipes Placement / Interview / CandidateResume /
    // CandidateListMembership / CallLog / SmsMessage / GmailThreadTag /
    // ActivityLog rows scoped to this candidate before dropping the
    // Candidate row. Org-scoped lookup is re-verified inside.
    const result = await deleteCandidateAction(candidate.id);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Failed to delete candidate." },
        { status: 500 },
      );
    }

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);

    return NextResponse.json({
      ok: true,
      message: `Deleted ${candName}.`,
      redirect: "/candidates",
    });
  }

  if (name === "reset_activity_log") {
    // The card shipped the parsed ISO bounds; we re-derive a Date here
    // to feed Prisma. Tenant scope is org-only — we never trust the
    // panel to scope this for us.
    const fromIso =
      typeof resolved.dateFromIso === "string" ? resolved.dateFromIso : "";
    const toIso = typeof resolved.dateToIso === "string" ? resolved.dateToIso : "";
    const fromLabel =
      typeof resolved.dateFromLabel === "string" ? resolved.dateFromLabel : "(beginning)";
    const toLabel =
      typeof resolved.dateToLabel === "string" ? resolved.dateToLabel : "(now)";

    const where: Prisma.ActionLogWhereInput = { organizationId: org.id };
    if (fromIso || toIso) {
      const range: Prisma.DateTimeFilter = {};
      if (fromIso) {
        const d = new Date(fromIso);
        if (!Number.isNaN(d.getTime())) range.gte = d;
      }
      if (toIso) {
        const d = new Date(toIso);
        if (!Number.isNaN(d.getTime())) range.lt = d;
      }
      if (range.gte || range.lt) where.createdAt = range;
    }

    const result = await prisma.actionLog.deleteMany({ where });

    // Audit row lands AFTER the deleteMany so the reset itself isn't
    // wiped by the same query. Records what was just removed in
    // metadata for forensics.
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "data_reset_activity_log",
      targetType: "organization",
      targetId: org.id,
      metadata: {
        deletedCount: result.count,
        dateFromIso: fromIso || null,
        dateToIso: toIso || null,
        source: "claude_panel",
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Deleted ${result.count} activity log ${
        result.count === 1 ? "entry" : "entries"
      } from ${fromLabel} to ${toLabel}.`,
    });
  }

  if (name === "reset_placements") {
    // Confirm executes on the exact ids the recruiter saw in the card,
    // not on a re-evaluated filter — that way a placement created after
    // the preview but before confirm doesn't get caught in the sweep.
    const rawIds = Array.isArray(resolved.placementIds) ? resolved.placementIds : [];
    const placementIds = rawIds.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (placementIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No placements selected to delete." },
        { status: 400 },
      );
    }

    // Re-verify every id belongs to this org. The chat route already
    // org-scoped them but the action route can't trust client payloads.
    const rows = await prisma.placement.findMany({
      where: { id: { in: placementIds }, organizationId: org.id },
      select: {
        id: true,
        candidateId: true,
        candidateRfId: true,
        jobId: true,
        jobRfId: true,
      },
    });
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "None of the selected placements are in this org." },
        { status: 404 },
      );
    }

    // Build the (candidate, job) tuples we'll use to clear dependent
    // Interview rows. Interview has no FK to Placement — the link is
    // implicit through the matching candidate + job pair.
    const interviewOr: Prisma.InterviewWhereInput[] = [];
    for (const r of rows) {
      const part: Prisma.InterviewWhereInput = {};
      if (r.candidateId != null) part.candidateId = r.candidateId;
      else if (r.candidateRfId != null) part.candidateRfId = r.candidateRfId;
      else continue;
      if (r.jobId != null) part.jobId = r.jobId;
      else if (r.jobRfId != null) part.jobRfId = r.jobRfId;
      else continue;
      interviewOr.push(part);
    }

    // Transaction so a mid-flight failure can't leave us with deleted
    // placements but orphaned interviews (or vice versa).
    const ids = rows.map((r) => r.id);
    const interviewDelete = interviewOr.length > 0
      ? prisma.interview.deleteMany({
          where: { organizationId: org.id, OR: interviewOr },
        })
      : prisma.interview.deleteMany({ where: { id: "__never_matches__" } });
    const [interviewDel, placementDel] = await prisma.$transaction([
      interviewDelete,
      prisma.placement.deleteMany({
        where: { id: { in: ids }, organizationId: org.id },
      }),
    ]);

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "data_reset_placements",
      targetType: "organization",
      targetId: org.id,
      metadata: {
        deletedPlacements: placementDel.count,
        deletedInterviews: interviewDel.count,
        placementIds: ids,
        source: "claude_panel",
      },
    });

    revalidatePath("/pipeline");
    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      message: `Deleted ${placementDel.count} placement${
        placementDel.count === 1 ? "" : "s"
      } and ${interviewDel.count} dependent interview row${
        interviewDel.count === 1 ? "" : "s"
      }.`,
    });
  }

  if (name === "update_placement_field") {
    const placementId =
      typeof resolved.placementId === "string" && resolved.placementId.length > 0
        ? resolved.placementId
        : typeof input.placementId === "string"
          ? input.placementId
          : "";
    const fieldName = typeof resolved.fieldName === "string" ? resolved.fieldName : "";
    const newValueRaw =
      typeof resolved.newValueRaw === "string"
        ? resolved.newValueRaw
        : typeof resolved.newValueRaw === "number"
          ? resolved.newValueRaw
          : null;
    const validationError =
      typeof resolved.validationError === "string" ? resolved.validationError : null;

    if (validationError) {
      return NextResponse.json(
        { ok: false, error: validationError },
        { status: 400 },
      );
    }
    if (!placementId) {
      return NextResponse.json(
        { ok: false, error: "placementId is required." },
        { status: 400 },
      );
    }

    const ALLOWED_FIELDS = [
      "placedAt",
      "startConfirmedAt",
      "stage",
      "feeAmount",
      "offerReceivedAt",
    ] as const;
    if (!(ALLOWED_FIELDS as ReadonlyArray<string>).includes(fieldName)) {
      return NextResponse.json(
        {
          ok: false,
          error: `fieldName must be one of: ${ALLOWED_FIELDS.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const placement = await prisma.placement.findFirst({
      where: { id: placementId, organizationId: org.id },
      select: {
        id: true,
        stage: true,
        placedAt: true,
        startConfirmedAt: true,
        offerReceivedAt: true,
        feeTotal: true,
        candidateRfId: true,
        candidateId: true,
        candidate: { select: { firstName: true, lastName: true } },
        job: { select: { title: true } },
      },
    });
    if (!placement) {
      return NextResponse.json(
        { ok: false, error: "Placement not found in this org." },
        { status: 404 },
      );
    }

    // Translate to the actual Prisma column + parsed value. The chat
    // route already validated shape; we just shuttle the value into
    // the right field. feeAmount maps to feeTotal (Int, whole dollars).
    const updateData: Prisma.PlacementUpdateInput = {};
    let oldValueLabel: string;
    let newValueLabel: string;
    if (fieldName === "stage") {
      if (typeof newValueRaw !== "string" || !isAllowedStage(newValueRaw)) {
        return NextResponse.json(
          { ok: false, error: "Invalid stage value." },
          { status: 400 },
        );
      }
      oldValueLabel = placement.stage;
      newValueLabel = newValueRaw;
      updateData.stage = newValueRaw;
      // Stage edits clear the RF sync flag so the next push to RF (if
      // ever re-enabled) recognizes this row drifted.
      updateData.syncedToRf = false;
    } else if (fieldName === "feeAmount") {
      if (typeof newValueRaw !== "number" || !Number.isInteger(newValueRaw) || newValueRaw < 0) {
        return NextResponse.json(
          { ok: false, error: "feeAmount must be a non-negative integer." },
          { status: 400 },
        );
      }
      oldValueLabel = placement.feeTotal != null ? `$${placement.feeTotal.toLocaleString("en-US")}` : "—";
      newValueLabel = `$${newValueRaw.toLocaleString("en-US")}`;
      updateData.feeTotal = newValueRaw;
    } else {
      // Date fields. newValueRaw is an ISO string from the resolver.
      if (typeof newValueRaw !== "string") {
        return NextResponse.json(
          { ok: false, error: "Date value missing." },
          { status: 400 },
        );
      }
      const parsed = new Date(newValueRaw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { ok: false, error: "Invalid date value." },
          { status: 400 },
        );
      }
      const currentVal =
        fieldName === "placedAt"
          ? placement.placedAt
          : fieldName === "startConfirmedAt"
            ? placement.startConfirmedAt
            : placement.offerReceivedAt;
      oldValueLabel = currentVal ? currentVal.toISOString().slice(0, 10) : "—";
      newValueLabel = parsed.toISOString().slice(0, 10);
      if (fieldName === "placedAt") updateData.placedAt = parsed;
      else if (fieldName === "startConfirmedAt") updateData.startConfirmedAt = parsed;
      else if (fieldName === "offerReceivedAt") updateData.offerReceivedAt = parsed;
    }

    await prisma.placement.update({
      where: { id: placement.id },
      data: updateData,
    });

    const candName =
      [placement.candidate?.firstName, placement.candidate?.lastName]
        .filter(Boolean)
        .join(" ") || "(unnamed)";
    const jobTitle = placement.job?.title ?? "(unknown job)";

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "data_update_placement_field",
      targetType: "placement",
      targetId: placement.id,
      metadata: {
        fieldName,
        oldValueLabel,
        newValueLabel,
        source: "claude_panel",
      },
    });

    revalidatePath("/pipeline");
    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    if (placement.candidateRfId) revalidatePath(`/candidates/${placement.candidateRfId}`);

    return NextResponse.json({
      ok: true,
      message: `Updated ${fieldName} on ${candName} · ${jobTitle}: ${oldValueLabel} → ${newValueLabel}.`,
    });
  }

  if (name === "create_reminders_batch") {
    // The over-the-cap fallback from the chat route: the recruiter
    // confirmed a bulk reminder create (>10 in one turn). The reminders
    // ride in `resolved.reminders`. createReminder() self-scopes org +
    // user from the session, so no client-supplied tenant id is trusted
    // here (Rule 8). Each item is re-validated for an explicit offset;
    // a naive one is reported as a failure, never created skewed.
    const rawReminders = Array.isArray(resolved.reminders)
      ? resolved.reminders
      : [];
    if (rawReminders.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No reminders to create." },
        { status: 400 },
      );
    }

    let created = 0;
    const failures: string[] = [];
    for (const raw of rawReminders) {
      const parsed = parseReminderToolInput(raw);
      if (!parsed.ok) {
        failures.push(`${parsed.title}: ${parsed.reason}`);
        continue;
      }
      try {
        await createReminder(parsed.title, parsed.reminderAtIso, parsed.notifyLeadsMin);
        created++;
      } catch (e) {
        failures.push(
          `${parsed.title}: ${e instanceof Error ? e.message : "create failed"}`,
        );
      }
    }

    const total = created + failures.length;
    const message =
      failures.length === 0
        ? `Created ${created} reminder${created === 1 ? "" : "s"}.`
        : `Created ${created} of ${total} reminder${
            total === 1 ? "" : "s"
          } — ${failures.length} failed: ${failures.slice(0, 5).join("; ")}.`;
    return NextResponse.json({ ok: true, message });
  }

  if (
    name === "inactivate_jobs" ||
    name === "reactivate_jobs" ||
    name === "delete_jobs" ||
    name === "delete_candidates"
  ) {
    // BULK action confirmed by the recruiter. The chat route's
    // describeAction already resolved each id to a canonical org-scoped
    // cuid and shipped them in resolved.items ([{ id, label }]); we
    // RE-RESOLVE every id org-scoped AGAIN inside the loop (Rule 8,
    // defense-in-depth — never trust the client array) and run the EXACT
    // per-item mutation the matching single-id handler runs:
    //   • inactivate_jobs / reactivate_jobs → the same prisma.job.update
    //     lifecycle write + logActivity (no-op when already in target).
    //   • delete_jobs → logActivity-before + prisma.job.delete, the same
    //     DB-level cascade (Placement / Interview / CandidateMatch) the
    //     single delete_job uses — NO new or widened cascade.
    //   • delete_candidates → deleteCandidateAction, the same cascading
    //     transaction the profile Delete button + single delete_candidate
    //     call (8 child tables + Candidate).
    // One item failing is caught and recorded — it NEVER aborts the
    // batch; succeeded items stay committed. Revalidation runs ONCE after
    // the loop over the collected path set, never per item, and the bulk
    // path deliberately returns NO redirect (unlike single delete, the
    // recruiter isn't sitting on one deleted record's detail page — the
    // client router.refresh() re-renders whatever list is open).
    const isCandidate = name === "delete_candidates";
    const isDelete = name === "delete_jobs" || name === "delete_candidates";
    const noun: "job" | "candidate" = isCandidate ? "candidate" : "job";
    const target: "active" | "inactive" | null =
      name === "inactivate_jobs"
        ? "inactive"
        : name === "reactivate_jobs"
          ? "active"
          : null;

    // Work list: prefer the resolved cuid list from the chat route; fall
    // back to the raw id array in input when resolved.items is absent
    // (forged / legacy POST). label is carried only for failure copy.
    type WorkItem = { ref: string; label: string };
    const work: WorkItem[] = [];
    const rawItems = Array.isArray(resolved.items) ? resolved.items : [];
    if (rawItems.length > 0) {
      for (const it of rawItems) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const ref = typeof o.id === "string" ? o.id : "";
        if (!ref) continue;
        work.push({ ref, label: typeof o.label === "string" ? o.label : ref });
      }
    } else {
      const rawIds = isCandidate ? input.candidateIds : input.jobIds;
      if (Array.isArray(rawIds)) {
        for (const r of rawIds) {
          if (typeof r === "string" && r.trim()) work.push({ ref: r, label: r });
        }
      }
    }

    if (work.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No targets to act on." },
        { status: 400 },
      );
    }

    let done = 0;
    const failures: Array<{ label: string; reason: string }> = [];
    const paths = new Set<string>();
    paths.add(isCandidate ? "/candidates" : "/jobs");
    if (!isCandidate) paths.add("/pipeline");

    for (const item of work) {
      try {
        if (isCandidate) {
          const candidate = await resolveCandidate(item.ref, org.id);
          if (!candidate) {
            failures.push({ label: item.label, reason: "not found in this org" });
            continue;
          }
          const result = await deleteCandidateAction(candidate.id);
          if (!result.ok) {
            failures.push({
              label: item.label,
              reason: result.error || "delete failed",
            });
            continue;
          }
          paths.add(`/candidates/${candidate.id}`);
          if (candidate.rfId != null) paths.add(`/candidates/${candidate.rfId}`);
          done++;
        } else {
          const fallback = await resolveJob(item.ref, org.id);
          const job = fallback
            ? await prisma.job.findFirst({
                where: { id: fallback.id, organizationId: org.id },
                select: {
                  id: true,
                  legacyRfId: true,
                  title: true,
                  isOpen: true,
                  lifecycle: true,
                  clientId: true,
                },
              })
            : null;
          if (!job) {
            failures.push({ label: item.label, reason: "not found in this org" });
            continue;
          }

          if (isDelete) {
            // logActivity BEFORE the delete so the audit row survives the
            // cascade (same ordering as the single delete_job handler).
            await logActivity({
              organizationId: org.id,
              userId: user.id,
              actionType: "job_deleted",
              targetType: "job",
              targetId: job.id,
              metadata: {
                jobTitle: job.title,
                clientId: job.clientId,
                legacyRfId: job.legacyRfId,
                source: "claude_panel_bulk",
              },
            });
            await prisma.job.delete({ where: { id: job.id } });
            paths.add(`/jobs/${job.id}`);
            if (job.legacyRfId != null) paths.add(`/jobs/${job.legacyRfId}`);
            if (job.clientId) paths.add(`/clients/${job.clientId}`);
            done++;
          } else {
            // Lifecycle update — identical logic to the single handler,
            // including the already-in-target no-op (counts as done: the
            // desired end state is reached, mirroring the single handler
            // returning ok for "already X").
            const current: "active" | "private" | "inactive" =
              job.lifecycle === "private" ||
              job.lifecycle === "inactive" ||
              job.lifecycle === "active"
                ? job.lifecycle
                : job.isOpen
                  ? "active"
                  : "inactive";
            if (target && current !== target) {
              await prisma.job.update({
                where: { id: job.id },
                data: {
                  lifecycle: target,
                  isOpen: target !== "inactive",
                  ...(target === "active" ? {} : { publishToWebsite: false }),
                },
              });
              await logActivity({
                organizationId: org.id,
                userId: user.id,
                actionType:
                  target === "inactive" ? "job_inactivated" : "job_reactivated",
                targetType: "job",
                targetId: job.id,
                metadata: {
                  jobTitle: job.title,
                  fromLifecycle: current,
                  toLifecycle: target,
                  source: "claude_panel_bulk",
                },
              });
            }
            paths.add(`/jobs/${job.id}`);
            if (job.legacyRfId != null) paths.add(`/jobs/${job.legacyRfId}`);
            done++;
          }
        }
      } catch (e) {
        failures.push({
          label: item.label,
          reason: e instanceof Error ? e.message : "action failed",
        });
      }
    }

    // ONE revalidation pass after the whole batch — never per item.
    Array.from(paths).forEach((p) => revalidatePath(p));
    if (!isCandidate && done > 0) {
      await triggerJobsSiteRebuild(`jobs-bulk-${name}`);
    }

    const total = done + failures.length;
    const verbPast =
      name === "inactivate_jobs"
        ? "Inactivated"
        : name === "reactivate_jobs"
          ? "Reactivated"
          : "Deleted";
    const nounPl = (n: number) => `${noun}${n === 1 ? "" : "s"}`;
    const message =
      failures.length === 0
        ? `${verbPast} ${done} ${nounPl(done)}.`
        : `${verbPast} ${done} of ${total} ${nounPl(total)} - ${
            failures.length
          } failed: ${failures
            .slice(0, 5)
            .map((f) => `${f.label}: ${f.reason}`)
            .join("; ")}.`;

    // The receipt object is the batched-receipt DATA: it mirrors the
    // BatchReceipt shape (receiptKind = the noun, done/total/failed +
    // per-item failures) so the NEXT (UI) prompt can render a styled
    // BatchReceiptLine without reshaping. No SSE batch_receipt is sent
    // here — bulk executes on the action POST, so the receipt rides this
    // JSON response, consumed by handleConfirmAction.
    return NextResponse.json({
      ok: true,
      message,
      receipt: {
        receiptKind: noun,
        done,
        total,
        failed: failures.length,
        failures,
      },
    });
  }

  return NextResponse.json(
    { ok: false, error: `Unknown action: ${name}` },
    { status: 400 },
  );
}
