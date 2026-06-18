// One-off data correction: move Tyler Engstrom's placement on the
// "Mowat Mackie & Anderson" job from "interviewing" back to "submitted".
//
// WHY: before the cancelInterview stage-reversion fix, cancelling an
// interview never moved the placement stage. Tyler's only interview on this
// placement was cancelled, but the placement stayed stuck in "interviewing".
// The server fix handles all FUTURE cancels; this script repairs the one
// existing stuck row.
//
// SAFETY / GUARDS (identical to the server-side rule so this can't corrupt
// a legitimately-active row):
//   - Tenant-scoped: every query carries organizationId (default BreakPoint
//     Talent org; override with --org=<cuid>).
//   - Resolves the candidate by name (Tyler Engstrom) and the placement by a
//     client/job named "Mowat Mackie & Anderson".
//   - ONLY moves a placement whose stage is currently "interviewing". If it's
//     already submitted (or any other stage) the script reports and does NOT
//     write — so re-running is idempotent and an Offer/Hired row is never
//     pulled backward.
//   - ONLY moves when ZERO non-cancelled interviews remain for that placement
//     (same (candidate, jobRfId) grouping the app uses). If a live interview
//     exists, the script refuses to move it.
//   - Dry-run by DEFAULT: prints the before-stage, the remaining-interview
//     count, and the would-be after-stage, then STOPS. Pass --apply to write.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/fix-tyler-engstrom-interviewing-stage.ts            # dry run
//   npx tsx scripts/fix-tyler-engstrom-interviewing-stage.ts --apply    # write
//   npx tsx scripts/fix-tyler-engstrom-interviewing-stage.ts --org=<cuid> --apply

import { PrismaClient, type Prisma } from "@prisma/client";

import { syntheticIdFromCuid } from "../src/lib/candidates";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent
const CANDIDATE_FIRST = "Tyler";
const CANDIDATE_LAST = "Engstrom";
const JOB_OR_CLIENT_NAME = "Mowat Mackie & Anderson";

function parseArgs(argv: string[]): { orgId: string; apply: boolean } {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
  }
  return { orgId, apply };
}

async function main(): Promise<void> {
  const { orgId, apply } = parseArgs(process.argv);
  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}\n`);

  // 1) Resolve the candidate, tenant-scoped.
  const candidate = await prisma.candidate.findFirst({
    where: {
      organizationId: orgId,
      firstName: { equals: CANDIDATE_FIRST, mode: "insensitive" },
      lastName: { equals: CANDIDATE_LAST, mode: "insensitive" },
    },
    select: { id: true, rfId: true, firstName: true, lastName: true },
  });
  if (!candidate) {
    console.log(`No candidate "${CANDIDATE_FIRST} ${CANDIDATE_LAST}" in org ${orgId}. Nothing to do.`);
    return;
  }
  console.log(`Candidate: ${candidate.firstName} ${candidate.lastName}  id=${candidate.id}  rfId=${candidate.rfId ?? "—"}`);

  // Candidate identity used across Placement + Interview rows: candidateId
  // (Ace-native cuid) OR candidateRfId (RF import). Match both.
  const candidateOr: Prisma.PlacementWhereInput[] = [{ candidateId: candidate.id }];
  if (candidate.rfId != null) candidateOr.push({ candidateRfId: candidate.rfId });

  // 2) Pull every placement for this candidate (tenant-scoped) and resolve the
  //    client name + job title so we can match "Mowat Mackie & Anderson".
  const placements = await prisma.placement.findMany({
    where: { organizationId: orgId, OR: candidateOr },
    select: {
      id: true,
      stage: true,
      jobRfId: true,
      jobId: true,
      clientId: true,
      clientRfId: true,
    },
  });
  console.log(`\nFound ${placements.length} placement(s) for this candidate:`);

  type Resolved = {
    placementId: string;
    stage: string;
    // The rfId interviews for this placement's job carry: real positive for RF
    // jobs, synthetic-negative syntheticIdFromCuid(jobId) for Ace-native jobs.
    // Placement.jobRfId is null for Ace-native rows, so derive it from jobId.
    rfFacingJobId: number | null;
    label: string;
    matches: boolean;
  };
  const resolved: Resolved[] = [];
  for (const p of placements) {
    const job = p.jobId
      ? await prisma.job.findFirst({ where: { id: p.jobId, organizationId: orgId }, select: { title: true } })
      : p.jobRfId != null
        ? await prisma.job.findFirst({ where: { legacyRfId: p.jobRfId, organizationId: orgId }, select: { title: true } })
        : null;
    const client = p.clientId
      ? await prisma.client.findFirst({ where: { id: p.clientId, organizationId: orgId }, select: { name: true } })
      : p.clientRfId != null
        ? await prisma.client.findFirst({ where: { legacyRfId: p.clientRfId, organizationId: orgId }, select: { name: true } })
        : null;
    const jobTitle = job?.title ?? "(unknown job)";
    const clientName = client?.name ?? "(unknown client)";
    const needle = JOB_OR_CLIENT_NAME.toLowerCase();
    const matches =
      jobTitle.toLowerCase().includes(needle) || clientName.toLowerCase().includes(needle);
    const rfFacingJobId = p.jobRfId ?? (p.jobId ? syntheticIdFromCuid(p.jobId) : null);
    const label = `client="${clientName}" job="${jobTitle}"`;
    resolved.push({ placementId: p.id, stage: p.stage, rfFacingJobId, label, matches });
    console.log(`  - ${p.id}  stage=${p.stage}  ${label}${matches ? "   <-- MATCH" : ""}`);
  }

  const target = resolved.find((r) => r.matches);
  if (!target) {
    console.log(`\nNo placement matched "${JOB_OR_CLIENT_NAME}". Nothing to do.`);
    return;
  }

  console.log(`\nTarget placement: ${target.placementId}  (${target.label})`);
  console.log(`  Current stage: ${target.stage}`);

  if (target.stage !== "interviewing") {
    console.log(`  Stage is not "interviewing" — refusing to move (already corrected, or a later stage). No write.`);
    return;
  }

  // 3) Guard: zero non-cancelled interviews remaining for this placement.
  // Interviews are grouped by jobRfId; for this placement that is the
  // rf-facing job id derived above (synthetic for Ace-native jobs). Counting
  // by candidate ALONE would wrongly fold in interviews from the candidate's
  // OTHER placements (Tyler also has a live interview on a different job).
  if (target.rfFacingJobId == null) {
    console.log(`  Could not resolve this placement's job rfId — refusing to move. No write.`);
    return;
  }
  const interviewWhere: Prisma.InterviewWhereInput = {
    organizationId: orgId,
    status: { not: "cancelled" },
    jobRfId: target.rfFacingJobId,
    OR: [
      { candidateId: candidate.id },
      ...(candidate.rfId != null ? [{ candidateRfId: candidate.rfId } as Prisma.InterviewWhereInput] : []),
    ],
  };
  const activeInterviews = await prisma.interview.count({ where: interviewWhere });
  console.log(`  Non-cancelled interviews remaining for this placement: ${activeInterviews}`);

  if (activeInterviews > 0) {
    console.log(`  A live interview still exists — refusing to move. No write.`);
    return;
  }

  console.log(`  Would move stage: interviewing -> submitted`);
  if (!apply) {
    console.log(`\nDRY RUN complete. Re-run with --apply to write.`);
    return;
  }

  const updated = await prisma.placement.update({
    where: { id: target.placementId },
    data: { stage: "submitted", syncedToRf: false },
    select: { id: true, stage: true },
  });
  console.log(`\nAPPLIED. Placement ${updated.id} stage is now "${updated.stage}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
