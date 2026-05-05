import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { applyLocalCandidateToJob } from "@/app/candidates/[id]/local-placement-actions";

export const dynamic = "force-dynamic";

// POST /api/placements
// Body: { candidateId: string, jobId: string, stage: "APPLIED" | "REJECTED" }
//
// One-click pipeline mutation from the Game Plan surfaces. APPLIED
// wraps the existing applyLocalCandidateToJob server action (auth,
// org scope, dupe check, ActivityLog, applied-confirmation email
// trigger all live there). REJECTED is handled inline because the
// recruiter typically rejects from a Matched-tab card that has no
// existing Placement, so we upsert one straight to stage=rejected
// instead of going through the rejectLocalPlacement flow which
// requires an existing Placement row.
//
// Submit still routes through the candidate profile's Submit modal —
// it's a multi-step flow (writeup generation, email send) that
// doesn't fit a one-click body.

export async function POST(req: Request) {
  let body: { candidateId?: string; jobId?: string; stage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const stage = typeof body.stage === "string" ? body.stage.toUpperCase() : "";
  if (!candidateId || !jobId) {
    return NextResponse.json(
      { ok: false, error: "candidateId and jobId required" },
      { status: 400 },
    );
  }
  if (stage !== "APPLIED" && stage !== "REJECTED") {
    return NextResponse.json(
      { ok: false, error: `Unsupported stage: ${stage}` },
      { status: 400 },
    );
  }

  // Tenant-scoped lookups so the route confirms both rows belong to
  // the caller's org BEFORE the apply action runs (the action also
  // scopes via getCurrentOrg, but failing here yields a cleaner 4xx
  // than a generic action error).
  const org = await getCurrentOrg();

  const [candidate, job] = await Promise.all([
    prisma.candidate.findFirst({
      where: { id: candidateId, organizationId: org.id },
      select: { id: true, rfId: true },
    }),
    prisma.job.findFirst({
      where: { id: jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true, clientId: true },
    }),
  ]);
  if (!candidate) {
    return NextResponse.json({ ok: false, error: "Candidate not found" }, { status: 404 });
  }
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  // Resolve clientRfId off the Job's client when the Job is RF-imported.
  // Ace-native jobs may have a client without a legacyRfId — that's fine,
  // the action writes nulls into rfId mirrors and points at the cuid FKs.
  let clientRfId: number | null = null;
  if (job.clientId) {
    const cl = await prisma.client.findFirst({
      where: { id: job.clientId, organizationId: org.id },
      select: { legacyRfId: true },
    });
    clientRfId = cl?.legacyRfId ?? null;
  }

  if (stage === "APPLIED") {
    // Pass the resolved jobRfId (legacyRfId) when the job is RF-imported
    // so the Placement carries BOTH identity keys. Older callers were
    // hardcoded to null, which left the Placement unfindable by the
    // /jobs/[id] pipeline query (which scopes by jobRfId for RF-imported
    // jobs) and the /applicants list (which renders job info via the
    // legacy RF lookup) — the row appeared in neither, even though the
    // database had it.
    const result = await applyLocalCandidateToJob({
      candidateId: candidate.id,
      jobRfId: job.legacyRfId,
      jobId: job.id,
      clientRfId,
      clientId: job.clientId,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  // stage === "REJECTED" — upsert a Placement at stage=rejected. If a
  // Placement already exists for this (candidate, job), bump it to
  // rejected; otherwise create one. Both paths skip RF sync (Ace-only
  // path, syncedToRf: false) and emit an activity-log entry so the
  // pipeline view + audit trail both reflect the move.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found." }, { status: 401 });
  }

  const existing = await prisma.placement.findUnique({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    select: { id: true, stage: true },
  });
  if (existing) {
    if (existing.stage !== "rejected") {
      await prisma.placement.update({
        where: { id: existing.id },
        data: { stage: "rejected", syncedToRf: false, invoicingFlagged: false },
      });
    }
  } else {
    // Same dual-identity rule as the APPLIED branch above: carry
    // job.legacyRfId in jobRfId for RF-imported jobs so the Placement
    // is findable by callers that filter on either key shape.
    await prisma.placement.create({
      data: {
        candidateId: candidate.id,
        candidateRfId: null,
        jobRfId: job.legacyRfId,
        jobId: job.id,
        clientRfId,
        clientId: job.clientId,
        stage: "rejected",
        source: "recruiter_rejected",
        createdById: user.id,
        organizationId: org.id,
        syncedToRf: false,
      },
    });
  }

  await logActivity({
    organizationId: org.id,
    userId: user.id,
    actionType: "candidate_rejected_for_job",
    targetType: "candidate",
    targetId: candidate.id,
    metadata: {
      jobId: job.id,
      jobRfId: job.legacyRfId,
      clientId: job.clientId,
      clientRfId,
      reason: "find_matches_reject",
    },
  });

  return NextResponse.json({ ok: true });
}
