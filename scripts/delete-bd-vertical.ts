// One-shot, idempotent: fully delete a BD vertical and its dependent rows for
// one organization. Built to retire the "Manufacturing" vertical Andrew is not
// using, but parameterized (--name=) so it can retire any unused vertical later.
//
// WHAT GETS DELETED
// The prompt's explicit targets are the Vertical row, its SavedSearch rows, and
// its BdContactTargeting row. But the Prisma schema FKs to Vertical mean a
// vertical delete CASCADES wider than that — record the full blast radius here
// so nobody is surprised:
//   - SavedSearch          -> onDelete: Cascade  (also cascades SavedSearchVersion)
//   - BdContactTargeting   -> onDelete: Cascade
//   - BDRun                -> onDelete: Cascade  (run HISTORY tied to this vertical
//                                                 is destroyed; cascades CampaignEvent
//                                                 + BDActivity under those runs)
//   - Campaign             -> onDelete: Cascade
//   - ClientSignal         -> onDelete: SetNull  (signals are KEPT; they just lose
//                                                 the verticalId link)
// The Vertical's per-vertical daily cap is the `Vertical.dailyCap` column on the
// row itself, so it goes away with the row (there is no separate cap table).
//
// SAFETY
// Dry-run by default: it resolves the vertical, prints every dependent count
// (SavedSearch, BDRun-by-status, Campaign, ClientSignal, BdContactTargeting,
// dailyCap) and STOPS. Pass --apply to actually write.
// HARD BLOCK: if any BDRun tied to the vertical is in a LIVE state
// (QUEUED / RUNNING / AWAITING_APPROVAL / APPROVED) the script refuses to apply
// and tells you to resolve that run first — a live run must never be yanked out
// from under the enroll flow. Historical runs (COMPLETE / FAILED / DISMISSED)
// do NOT block, but the dry-run reports them so you can decide before --apply,
// because deleting the vertical cascades them away.
// Scoped to one organization per the tenant rule; defaults to the BreakPoint
// Talent org, override with --org=<orgCuid>.
// Idempotent: once the vertical is gone, a re-run reports "not found" and exits
// cleanly with no writes.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/delete-bd-vertical.ts                       # dry run, Manufacturing, default org
//   npx tsx scripts/delete-bd-vertical.ts --apply               # write
//   npx tsx scripts/delete-bd-vertical.ts --name="Manufacturing" --org=<cuid> --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent is the only prod org today; keep it as the default so a
// bare run is still safely scoped, but allow --org=<cuid> for future re-runs.
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";
const DEFAULT_VERTICAL_NAME = "Manufacturing";

// A BDRun in any of these states is mid-flight through discovery/approval/enroll
// and must NOT be deleted out from under the pipeline. These block --apply.
const LIVE_RUN_STATUSES = ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "APPROVED"] as const;

function parseArgs(argv: string[]): { orgId: string; name: string; apply: boolean } {
  let orgId = DEFAULT_ORG_ID;
  let name = DEFAULT_VERTICAL_NAME;
  let apply = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length);
  }
  return { orgId, name, apply };
}

async function main(): Promise<void> {
  const { orgId, name, apply } = parseArgs(process.argv);

  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}, vertical "${name}"\n`);

  // Resolve the vertical by name (case-insensitive), tenant-scoped. Resolving
  // by name + org keeps the script idempotent: after deletion the next run
  // finds nothing and exits cleanly.
  const vertical = await prisma.vertical.findFirst({
    where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, slug: true, dailyCap: true },
  });

  if (!vertical) {
    console.log(
      `No vertical named "${name}" found for org ${orgId}. ` +
        `Nothing to do (already deleted, or never existed).`,
    );
    return;
  }

  const verticalId = vertical.id;

  // Count every dependent FK before touching anything, so the report and the
  // write target the same rows and the full cascade is visible up front.
  const [savedSearches, runsByStatus, campaignCount, clientSignalCount, targeting] =
    await Promise.all([
      prisma.savedSearch.findMany({
        where: { organizationId: orgId, verticalId },
        select: { id: true, name: true, active: true },
      }),
      prisma.bDRun.groupBy({
        by: ["status"],
        where: { organizationId: orgId, verticalId },
        _count: { _all: true },
      }),
      prisma.campaign.count({ where: { organizationId: orgId, verticalId } }),
      prisma.clientSignal.count({ where: { organizationId: orgId, verticalId } }),
      prisma.bdContactTargeting.findFirst({
        where: { organizationId: orgId, verticalId },
        select: {
          id: true,
          primaryTitles: true,
          smallFirmFallbackTitles: true,
          practiceSpecificTitles: true,
        },
      }),
    ]);

  const runCounts = new Map<string, number>();
  for (const r of runsByStatus) runCounts.set(r.status, r._count._all);
  const totalRuns = Array.from(runCounts.values()).reduce((a, b) => a + b, 0);
  const liveRuns = LIVE_RUN_STATUSES.map((s) => ({ status: s, count: runCounts.get(s) ?? 0 })).filter(
    (x) => x.count > 0,
  );
  const liveRunTotal = liveRuns.reduce((a, b) => a + b.count, 0);

  // ----- Report -----
  console.log(`Vertical: ${vertical.name}  (id=${verticalId}, slug=${vertical.slug})`);
  console.log(`  dailyCap (column on the row): ${vertical.dailyCap ?? "null (inherits global)"}`);
  console.log(`\nDependent rows tied to this vertical:`);
  console.log(`  SavedSearch rows:        ${savedSearches.length}`);
  for (const s of savedSearches) {
    console.log(`     - "${s.name}" (id=${s.id}, active=${s.active})`);
  }
  console.log(
    `  BdContactTargeting row:  ${
      targeting
        ? `1 (primary=${targeting.primaryTitles.length}, smallFirm=${targeting.smallFirmFallbackTitles.length}, practice=${targeting.practiceSpecificTitles.length})`
        : "0"
    }`,
  );
  console.log(`  BDRun rows:              ${totalRuns}`);
  if (totalRuns > 0) {
    for (const [status, count] of Array.from(runCounts)) console.log(`     - ${status}: ${count}`);
  }
  console.log(`  Campaign rows:           ${campaignCount}`);
  console.log(
    `  ClientSignal rows:       ${clientSignalCount}  (NOT deleted — FK is SetNull; verticalId is nulled)`,
  );

  console.log(`\nCASCADE on vertical delete:`);
  console.log(
    `  Deletes (Cascade): the ${savedSearches.length} SavedSearch row(s), ` +
      `${targeting ? "1" : "0"} BdContactTargeting row, ${totalRuns} BDRun row(s) (run history), ` +
      `${campaignCount} Campaign row(s), plus any CampaignEvent/BDActivity/SavedSearchVersion under them.`,
  );
  console.log(`  Preserves (SetNull): ${clientSignalCount} ClientSignal row(s) — verticalId set to null.`);

  // ----- Live-run hard block -----
  if (liveRunTotal > 0) {
    console.log(
      `\n*** BLOCKED: ${liveRunTotal} LIVE BDRun(s) reference this vertical: ` +
        liveRuns.map((x) => `${x.status}=${x.count}`).join(", ") +
        `. ***\nResolve/dismiss those runs first; refusing to delete a vertical with a live run.`,
    );
    if (apply) process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\nDry run — no changes written. Re-run with --apply to delete.`);
    return;
  }

  // ----- Write (atomic, tenant-scoped) -----
  // Explicitly delete the prompt's named targets (BdContactTargeting +
  // SavedSearch) first, then the Vertical row; the Vertical delete cascades any
  // remaining BDRun/Campaign rows by verticalId and SetNulls ClientSignal. All
  // in one $transaction so it lands whole or not at all. Every delete is
  // org-scoped so the write can never reach another tenant.
  const [targetingDel, savedSearchDel] = await prisma.$transaction([
    prisma.bdContactTargeting.deleteMany({ where: { organizationId: orgId, verticalId } }),
    prisma.savedSearch.deleteMany({ where: { organizationId: orgId, verticalId } }),
    prisma.vertical.delete({ where: { id: verticalId } }),
  ]);

  console.log(
    `\nDeleted vertical "${vertical.name}" (1 row), ` +
      `${savedSearchDel.count} SavedSearch row(s), ` +
      `${targetingDel.count} BdContactTargeting row(s). ` +
      `Any BDRun/Campaign rows tied to it cascaded; ClientSignals were preserved (verticalId nulled).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
