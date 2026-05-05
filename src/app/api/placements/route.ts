import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { applyLocalCandidateToJob } from "@/app/candidates/[id]/local-placement-actions";

export const dynamic = "force-dynamic";

// POST /api/placements
// Body: { candidateId: string, jobId: string, stage: "APPLIED" }
//
// One-click apply from the Game Plan Find Matches panel. Wraps the
// existing applyLocalCandidateToJob server action (auth, org scope,
// dupe check, ActivityLog all live there) so the panel can fire a
// single fetch without bouncing the recruiter through the candidate
// profile + Apply modal.
//
// Stage is intentionally constrained to "APPLIED" for now; the
// existing modal handles the richer flows (Submit / Reject / etc.)
// without modification per Prompt 2 spec.

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
  if (stage !== "APPLIED") {
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
  // eslint-disable-next-line no-console
  console.log("[placements] org.id =", org.id, "candidateId =", candidateId, "jobId =", jobId);

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

  const result = await applyLocalCandidateToJob({
    candidateId: candidate.id,
    jobRfId: null,
    jobId: job.id,
    clientRfId,
    clientId: job.clientId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
