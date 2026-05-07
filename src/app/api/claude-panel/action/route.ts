import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import type { PlacementStage } from "@/lib/placements";

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
    const subject = typeof input.subject === "string" ? input.subject : "";
    const emailBody = typeof input.body === "string" ? input.body : "";
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

  return NextResponse.json(
    { ok: false, error: `Unknown action: ${name}` },
    { status: 400 },
  );
}
