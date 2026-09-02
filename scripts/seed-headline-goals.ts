// Seeds the headline meter row for the CURRENT quarter.
//
// Two things, both idempotent:
//   1. Creates a QUARTERLY PLACEMENTS goal for the current quarter if none
//      exists. See the target note below.
//   2. Flags the quarter's REVENUE, SIGNED_CLIENTS and PLACEMENTS goals as
//      isHeadline, so they render as meter cards above the goal list.
//
// THE PLACEMENTS TARGET, and why it is 9 rather than 19.
//
// Two defensible numbers, and they disagree:
//   - 19, from the money. The quarterly revenue goal is $125,000 and the
//     observed average deal is $6,625 (billed over placements, Q3 2026), so
//     $125,000 / $6,625 = 18.9 placements. This is the target that makes
//     the revenue goal and the placements goal arithmetically consistent -
//     hit one and you hit the other.
//   - 9, from the desk. Actual placements ran 0 / 2 / 6 across Q1-Q3 2026,
//     so 19 is 3.2x the best quarter yet recorded. A goal nobody can reach
//     reads Behind every single day and stops being information.
//
// 9 is seeded: it matches the SIGNED_CLIENTS quarterly target already in
// place (one placement per signed client is the simplest coherent
// expectation), and it is a genuine stretch over the best observed quarter
// without being fiction. It is ALSO under the 20-unit segment limit, so the
// meter draws nine countable segments rather than a continuous bar.
//
// If Andrew wants the goals to be arithmetically consistent with $125,000
// instead, raise it to 19 and accept a permanently red meter until the
// average deal size rises. That is a business call, not a data one.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/seed-headline-goals.ts            # dry run
//   npx tsx scripts/seed-headline-goals.ts --apply    # write

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent
const OWNER_EMAIL = "andrew@breakpointtalent.com";
const PLACEMENTS_TARGET = 9;

// Headline metrics for the current quarter, in the order they should read
// across the row: the money first, then the two counts that drive it.
const HEADLINE_METRICS = ["REVENUE", "SIGNED_CLIENTS", "PLACEMENTS"] as const;

function currentQuarterMarkers(now: Date): { start: Date; end: Date; label: string } {
  const y = now.getUTCFullYear();
  const qIndex = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(y, qIndex * 3, 1));
  const lastDay = new Date(Date.UTC(y, qIndex * 3 + 3, 0));
  // END-OF-DAY, matching the convention scripts/seed-goals-2026.ts used for
  // every existing goal (periodEnd is the last instant of the last day, not
  // its midnight). Creating with a different convention would leave two
  // shapes of quarterly goal in the table.
  const end = new Date(
    Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate(), 23, 59, 59, 999),
  );
  return { start, end, label: `Q${qIndex + 1} ${y}` };
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const orgId =
    process.argv.slice(2).find((a) => a.startsWith("--org="))?.slice("--org=".length) ??
    DEFAULT_ORG_ID;

  const { start, end, label } = currentQuarterMarkers(new Date());
  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} - headline goals for ${label}`);
  console.log(`window ${start.toISOString().slice(0, 10)} .. ${end.toISOString().slice(0, 10)}\n`);

  const owner = await prisma.user.findFirst({
    where: { email: OWNER_EMAIL },
    select: { id: true },
  });
  if (!owner) throw new Error(`No user for ${OWNER_EMAIL} - aborting, nothing written.`);

  // 1. The placements goal, if it is missing.
  const existingPlacements = await prisma.goal.findFirst({
    where: {
      organizationId: orgId,
      metric: "PLACEMENTS",
      period: "QUARTERLY",
      status: "ACTIVE",
      // Matched on periodStart alone. periodEnd is stored as the last
      // instant of the last day, so requiring equality on both bounds
      // silently missed the existing goals.
      periodStart: start,
    },
    select: { id: true },
  });
  if (existingPlacements) {
    console.log(`  unchanged  PLACEMENTS goal already exists for ${label}`);
  } else {
    console.log(`  CREATE     PLACEMENTS QUARTERLY ${label} target ${PLACEMENTS_TARGET}`);
    if (apply) {
      await prisma.goal.create({
        data: {
          organizationId: orgId,
          scope: "COMPANY",
          ownerUserId: null,
          metric: "PLACEMENTS",
          period: "QUARTERLY",
          periodStart: start,
          periodEnd: end,
          targetValue: PLACEMENTS_TARGET,
          status: "ACTIVE",
          createdByUserId: owner.id,
          approvedByUserId: owner.id,
          approvedAt: new Date(),
          notes:
            "Matches the quarterly signed-clients target. The revenue-consistent " +
            "figure at the current average deal size would be 19; see " +
            "scripts/seed-headline-goals.ts for the reasoning.",
        },
      });
    }
  }

  // 2. Flag the quarter's headline metrics.
  const goals = await prisma.goal.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      period: "QUARTERLY",
      periodStart: start,
      metric: { in: [...HEADLINE_METRICS] },
    },
    select: { id: true, metric: true, isHeadline: true },
  });

  let flagged = 0;
  let already = 0;
  for (const m of HEADLINE_METRICS) {
    const g = goals.find((x) => x.metric === m);
    if (!g) {
      // Only reachable on a dry run, where the placements goal above was
      // printed but not written.
      console.log(`  (pending)  ${m} - will exist after --apply`);
      continue;
    }
    if (g.isHeadline) {
      console.log(`  unchanged  ${m} already headline`);
      already += 1;
      continue;
    }
    console.log(`  SET        ${m} -> headline`);
    flagged += 1;
    if (apply) {
      await prisma.goal.update({ where: { id: g.id }, data: { isHeadline: true } });
    }
  }

  console.log(
    `\n${apply ? "Wrote" : "Would write"}: ${flagged} flagged, ${already} already headline.`,
  );
  if (!apply) console.log("Nothing was written. Re-run with --apply to write.\n");
  else console.log("Done. Re-running this script is a no-op.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
