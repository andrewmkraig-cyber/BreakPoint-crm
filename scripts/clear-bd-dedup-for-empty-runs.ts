// One-shot fix: clear the dedup history left behind by broken BDRuns.
//
// THE PROBLEM
// The bd-discovery cron dedups fresh results against the `discoveredPayload`
// of every BDRun created in the last 30 days (see
// src/app/api/cron/bd-discovery/route.ts — it builds a fingerprint Set from
// `companyName|jobTitle` pairs found in each run's payload). That window has
// no idea whether a run actually *enrolled* anyone. When a run discovered
// companies, wrote them into `discoveredPayload`, but then died during
// enrollment — leaving nameless shells and `enrolledCount = 0` while still
// flipping to `status = COMPLETE` — those companies are now "remembered" as
// already-seen. The next cron filters them out, so they can never resurface,
// even though they were never successfully enrolled.
//
// THE FIX
// Null out `discoveredPayload` on exactly those runs (enrolledCount = 0 AND
// status = COMPLETE or AWAITING_APPROVAL — an awaiting-approval run that
// enrolled nobody is blocking re-discovery just the same). The dedup loop
// does `if (!Array.isArray(payload))
// continue;`, so a null payload contributes zero fingerprints — the broken
// runs stop blocking re-discovery. The BDRow rows themselves stay intact
// (counts, metrics, timestamps, error message); only their dedup footprint
// is erased. Next cron run, those companies are eligible again.
//
// SAFETY
// Dry-run by default: it prints which runs it would clear and stops. Pass
// --apply to actually write. Scoped to one organization per the tenant rule;
// defaults to the BreakPoint Talent org, override with --org=<orgCuid>.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/clear-bd-dedup-for-empty-runs.ts            # dry run
//   npx tsx scripts/clear-bd-dedup-for-empty-runs.ts --apply    # write
//   npx tsx scripts/clear-bd-dedup-for-empty-runs.ts --org=<cuid> --apply

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent is the only prod org today; keep it as the default so a
// bare run is still safely scoped, but allow --org=<cuid> for future re-runs.
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";

function parseArgs(argv: string[]): { orgId: string; apply: boolean } {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
  }
  return { orgId, apply };
}

// Count how many company/job fingerprints a payload currently contributes to
// the dedup window — purely for reporting so we can see what each run was
// holding hostage. Mirrors the cron's own array/object guards.
function fingerprintCount(payload: unknown): number {
  if (!Array.isArray(payload)) return 0;
  let n = 0;
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.companyName === "string" ? obj.companyName : "";
    const title = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    if (name && title) n++;
  }
  return n;
}

async function main(): Promise<void> {
  const { orgId, apply } = parseArgs(process.argv);

  // Runs that finished but enrolled nobody. We filter the "still carries a
  // payload" condition in JS rather than in the WHERE, because Prisma's
  // null-filtering on a Json? column needs the DbNull/JsonNull sentinels and
  // is easy to get subtly wrong — selecting in JS keeps the report and the
  // write targeting exactly the same rows.
  const candidates = await prisma.bDRun.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["COMPLETE", "AWAITING_APPROVAL"] as const },
      enrolledCount: 0,
    },
    select: {
      id: true,
      createdAt: true,
      discoveredCount: true,
      enrolledCount: true,
      discoveredPayload: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // A run whose payload is already null contributes nothing to the dedup set,
  // so there's nothing to clear — drop it from both the report and the write.
  const runs = candidates.filter((r) => r.discoveredPayload != null);

  console.log(
    `\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}\n` +
      `Found ${runs.length} COMPLETE/AWAITING_APPROVAL run(s) with enrolledCount=0 and a non-null payload.\n`,
  );

  let totalFingerprints = 0;
  for (const r of runs) {
    const fp = fingerprintCount(r.discoveredPayload);
    totalFingerprints += fp;
    console.log(
      `  ${r.id}  created ${r.createdAt.toISOString()}  ` +
        `discovered=${r.discoveredCount} enrolled=${r.enrolledCount} ` +
        `dedupFingerprints=${fp}`,
    );
  }

  console.log(
    `\nThese runs are currently blocking ${totalFingerprints} ` +
      `company/job fingerprint(s) from re-discovery.\n`,
  );

  if (runs.length === 0) {
    console.log("Nothing to clear.");
    return;
  }

  if (!apply) {
    console.log("Dry run — no changes written. Re-run with --apply to clear.");
    return;
  }

  // Write by the exact IDs we just reported. Prisma.DbNull sets the column to
  // SQL NULL on a nullable Json field; the cron's `!Array.isArray(payload)`
  // guard then skips these runs entirely.
  const result = await prisma.bDRun.updateMany({
    where: { id: { in: runs.map((r) => r.id) } },
    data: { discoveredPayload: Prisma.DbNull },
  });

  console.log(
    `Cleared discoveredPayload on ${result.count} run(s). ` +
      `Those companies can be re-discovered on the next bd-discovery cron run.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
