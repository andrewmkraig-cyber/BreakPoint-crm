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
// Every branch revalidates the URLs the recruiter is most likely to
// have open after a stage move (pipeline, candidate profile) so the
// page they navigate to next reflects the write.

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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  let body: { name?: unknown; input?: unknown };
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
    const candidateId = typeof input.candidateId === "string" ? input.candidateId : "";
    const placementId = typeof input.placementId === "string" ? input.placementId : "";
    const newStage = typeof input.newStage === "string" ? input.newStage : "";
    if (!candidateId || !placementId || !newStage) {
      return NextResponse.json(
        { ok: false, error: "candidateId, placementId, and newStage are required" },
        { status: 400 },
      );
    }
    if (!isAllowedStage(newStage)) {
      return NextResponse.json(
        { ok: false, error: `newStage must be one of: ${ALLOWED_STAGES.join(", ")}` },
        { status: 400 },
      );
    }
    // Confirm the placement belongs to this org AND ties to the
    // candidate Claude named. Both checks happen in a single query so
    // a leaked id from another tenant or a mismatched candidate-vs-
    // placement pair both 404 cleanly.
    const placement = await prisma.placement.findFirst({
      where: { id: placementId, organizationId: org.id, candidateId },
      select: {
        id: true,
        stage: true,
        candidateRfId: true,
        job: { select: { title: true } },
        candidate: { select: { firstName: true, lastName: true } },
      },
    });
    if (!placement) {
      return NextResponse.json(
        { ok: false, error: "Placement not found for this candidate." },
        { status: 404 },
      );
    }
    const fromStage = placement.stage;
    await prisma.placement.update({
      where: { id: placementId },
      data: { stage: newStage, syncedToRf: false },
    });
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "claude_move_stage",
      targetType: "placement",
      targetId: placementId,
      metadata: { fromStage, toStage: newStage, candidateId, source: "claude_panel" },
    });
    revalidatePath("/pipeline");
    revalidatePath(`/candidates/${candidateId}`);
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
    const entityId = typeof input.entityId === "string" ? input.entityId : "";
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (!entityType || !entityId || !note) {
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
    // Verify the target exists in this org so we don't end up with
    // dangling activity-log rows pointing at a phantom id Claude made
    // up. logActivity itself swallows DB failures, so the check here
    // is the only authoritative org-scope guard for this branch.
    let entityName = "";
    if (entityType === "candidate") {
      const c = await prisma.candidate.findFirst({
        where: { id: entityId, organizationId: org.id },
        select: { firstName: true, lastName: true },
      });
      if (!c) {
        return NextResponse.json(
          { ok: false, error: "Candidate not found." },
          { status: 404 },
        );
      }
      entityName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unnamed)";
    } else if (entityType === "client") {
      const cl = await prisma.client.findFirst({
        where: { id: entityId, organizationId: org.id },
        select: { name: true },
      });
      if (!cl) {
        return NextResponse.json(
          { ok: false, error: "Client not found." },
          { status: 404 },
        );
      }
      entityName = cl.name;
    } else {
      const j = await prisma.job.findFirst({
        where: { id: entityId, organizationId: org.id },
        select: { title: true },
      });
      if (!j) {
        return NextResponse.json(
          { ok: false, error: "Job not found." },
          { status: 404 },
        );
      }
      entityName = j.title;
    }
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "note_added",
      targetType: entityType,
      targetId: entityId,
      metadata: { note, source: "claude_panel" },
    });
    revalidatePath(`/${entityType === "candidate" ? "candidates" : entityType === "client" ? "clients" : "jobs"}/${entityId}`);
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
