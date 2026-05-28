// One-time backfill: compute + store deterministic match scores for
// every existing candidate-job link, so Find Matches and the Matched
// tab show the new trajectory-aware scores on the next render
// without waiting for a recruiter to manually re-open the panel.
//
// What this covers:
//   1. Every Placement row (the candidate is already in the pipeline
//      for this job) — guarantees the pipeline + matched-candidates
//      surfaces have a stored score.
//   2. Every existing CandidateMatch row written by the legacy Claude
//      streaming path — guarantees those rows get rewritten with the
//      new deterministic algorithm + a valid sourceHash, so they no
//      longer look stale next to freshly-scored rows.
//
// Idempotent: re-running is safe. The upsert path inside
// `upsertMatchScore` skips recompute when the stored sourceHash
// matches the current inputs, so a second run is effectively a no-op
// SELECT pass.
//
// Run with:  npx tsx scripts/backfill-match-scores.ts
// or:        npx tsx scripts/backfill-match-scores.ts --org=<orgId>
//
// Tenant-scoped: every read carries WHERE organizationId. When --org
// is omitted the script iterates every Organization row.

import { PrismaClient } from "@prisma/client";
import { upsertMatchScore } from "../src/lib/match-scoring-store";

const prisma = new PrismaClient();

type Stats = { computed: number; skipped: number; failed: number };

function parseOrgArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--org="));
  if (!arg) return null;
  const v = arg.slice("--org=".length).trim();
  return v.length > 0 ? v : null;
}

async function backfillOrg(orgId: string, orgName: string): Promise<Stats> {
  const stats: Stats = { computed: 0, skipped: 0, failed: 0 };

  // 1. Placement rows (pipeline links).
  const placements = await prisma.placement.findMany({
    where: { organizationId: orgId, candidateId: { not: null }, jobId: { not: null } },
    select: { candidateId: true, jobId: true, stage: true },
  });
  console.log(`[${orgName}] placements: ${placements.length}`);
  // 2. CandidateMatch rows (existing Find Matches store).
  const existing = await prisma.candidateMatch.findMany({
    where: { organizationId: orgId },
    select: { candidateId: true, jobId: true },
  });
  console.log(`[${orgName}] candidate matches: ${existing.length}`);

  // Build the de-duped set of (candidateId, jobId) pairs to backfill.
  const pairs = new Map<string, { candidateId: string; jobId: string }>();
  for (const p of placements) {
    if (!p.candidateId || !p.jobId) continue;
    pairs.set(`${p.candidateId}__${p.jobId}`, { candidateId: p.candidateId, jobId: p.jobId });
  }
  for (const m of existing) {
    pairs.set(`${m.candidateId}__${m.jobId}`, { candidateId: m.candidateId, jobId: m.jobId });
  }

  console.log(`[${orgName}] unique (candidate, job) pairs: ${pairs.size}`);

  let i = 0;
  const pairList = Array.from(pairs.values());
  for (const { candidateId, jobId } of pairList) {
    i++;
    if (i % 100 === 0) console.log(`[${orgName}] processed ${i}/${pairs.size}`);
    try {
      const out = await upsertMatchScore({ orgId, candidateId, jobId });
      if (out == null) { stats.failed++; continue; }
      if (out.recomputed) stats.computed++; else stats.skipped++;
    } catch (e) {
      stats.failed++;
      console.warn("backfill row failed", { orgId, candidateId, jobId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return stats;
}

async function main() {
  const requestedOrgId = parseOrgArg();
  const orgs = requestedOrgId
    ? await prisma.organization.findMany({ where: { id: requestedOrgId }, select: { id: true, name: true } })
    : await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  if (orgs.length === 0) {
    console.log("No organizations to backfill.");
    return;
  }

  const totals: Stats = { computed: 0, skipped: 0, failed: 0 };
  for (const org of orgs) {
    console.log(`\n=== Org ${org.id} (${org.name}) ===`);
    const s = await backfillOrg(org.id, org.name);
    totals.computed += s.computed;
    totals.skipped += s.skipped;
    totals.failed += s.failed;
    console.log(`[${org.name}] result`, s);
  }

  console.log("\n=== Total ===");
  console.log(totals);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
