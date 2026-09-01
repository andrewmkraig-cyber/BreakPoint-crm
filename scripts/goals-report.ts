// Read-only correctness check for the goals engine. Writes NOTHING - there
// is no --apply flag and no code path here mutates a row.
//
// This is how the numbers get verified before any UI exists: for every
// ACTIVE goal in the org it prints the target, the resolved actual, the
// expected-to-date, the pace index and the status, plus the underlying
// record counts so each figure can be traced back by hand.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/goals-report.ts
//   npx tsx scripts/goals-report.ts --org=<cuid>
//   npx tsx scripts/goals-report.ts --now=2026-06-30   # pretend it is a date

import { GoalMetric, GoalPeriod, PrismaClient } from "@prisma/client";

import {
  countRawSubmitActions,
  etWindow,
  ownershipFieldFor,
  resolveMetric,
  resolvePlacements,
  type RevenueResult,
} from "../src/lib/goals/metrics";
import {
  pacingForCumulative,
  pacingForMilestone,
  pacingForRatio,
  pacingShapeFor,
  priorEquivalentPeriod,
  MILESTONE_RUN_RATE_DAYS,
} from "../src/lib/goals/pacing";

const prisma = new PrismaClient();
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent

function parseArgs(argv: string[]): { orgId: string; now: Date } {
  let orgId = DEFAULT_ORG_ID;
  let now = new Date();
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
    else if (arg.startsWith("--now=")) {
      const parsed = new Date(arg.slice("--now=".length));
      if (Number.isNaN(parsed.getTime())) throw new Error(`Bad --now: ${arg}`);
      now = parsed;
    }
  }
  return { orgId, now };
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function isMoney(metric: GoalMetric): boolean {
  return metric === GoalMetric.REVENUE || metric === GoalMetric.AVG_DEAL_SIZE;
}

function fmt(n: number | null, metric: GoalMetric): string {
  if (n === null) return "-";
  return isMoney(metric) ? usd.format(Math.round(n)) : String(Math.round(n * 100) / 100);
}

function day(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "-";
}

async function main(): Promise<void> {
  const { orgId, now } = parseArgs(process.argv);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`No organization ${orgId}`);

  const goals = await prisma.goal.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    orderBy: [{ period: "asc" }, { periodStart: "asc" }, { metric: "asc" }],
  });

  console.log(`\nGOALS REPORT - ${org.name} (${org.id})`);
  console.log(`As of ${now.toISOString()} (read-only, nothing was written)\n`);

  if (goals.length === 0) {
    console.log("No ACTIVE goals.\n");
    return;
  }

  // Owner names, resolved once, so each line can say whose number it is.
  const ownerIds = Array.from(
    new Set(goals.map((g) => g.ownerUserId).filter((id): id is string => Boolean(id))),
  );
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const ownerName = new Map(owners.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  for (const goal of goals) {
    const target = Number(goal.targetValue);
    const shape = pacingShapeFor(goal.metric, goal.period);
    const scopeLabel =
      goal.scope === "USER"
        ? `USER:${ownerName.get(goal.ownerUserId ?? "") ?? goal.ownerUserId}`
        : "COMPANY";

    // MILESTONE goals have no period. Everything in Ace predates 2026 by
    // less than this, so an all-time window opening in 2000 is safely
    // "since the beginning".
    const rangeStart = goal.periodStart ?? new Date(Date.UTC(2000, 0, 1));
    const rangeEnd = goal.periodEnd ?? now;

    const result = await resolveMetric({
      organizationId: orgId,
      metric: goal.metric,
      rangeStart,
      rangeEnd,
      ownerUserId: goal.ownerUserId,
      period: goal.period,
      goalId: goal.id,
    });

    const header =
      `${goal.metric.padEnd(21)} ${goal.period.padEnd(10)} ${scopeLabel.padEnd(16)} ` +
      `${day(goal.periodStart)} -> ${day(goal.periodEnd)}`;
    console.log(header);
    console.log(`  ${"-".repeat(Math.max(20, header.length - 2))}`);
    // Revenue prints all three tiers side by side: a placement made in Q1,
    // invoiced in Q1 and paid in Q2 is Q1 earned, Q1 billed, Q2 collected.
    // `actual` is the BILLED figure for every period EXCEPT MILESTONE,
    // which reads collected - see revenueHeadline() in metrics.ts.
    const bothRevenue = result.revenue
      ? `   [earned ${usd.format(Math.round(result.revenue.earned))} | ` +
        `billed ${usd.format(Math.round(result.revenue.billed))} | ` +
        `collected ${usd.format(Math.round(result.revenue.collected))}]` +
        (result.revenue.billedExceedsEarned
          ? "  <<< BILLED EXCEEDS EARNED - an invoice has no live placement behind it"
          : "")
      : "";
    console.log(
      `  target ${fmt(target, goal.metric).padStart(12)}   actual ${fmt(result.value, goal.metric).padStart(12)}` +
        bothRevenue +
        (goal.manualLabel ? `   label "${goal.manualLabel}"` : ""),
    );

    if (result.value === null) {
      console.log(`  NOT MEASURABLE: ${result.unsupportedReason ?? "no resolver"}`);
      const field = ownershipFieldFor(goal.metric);
      console.log(`  ownership field: ${field ?? "none (this model records no user)"}`);
      console.log("");
      continue;
    }

    // ---- Pacing ----
    if (shape === "CUMULATIVE" && goal.periodStart && goal.periodEnd) {
      const p = pacingForCumulative({
        target,
        actual: result.value,
        periodStart: goal.periodStart,
        periodEnd: goal.periodEnd,
        now,
        revenue: result.revenue,
      });
      console.log(
        `  expected to date ${fmt(p.expectedToDate, goal.metric).padStart(12)}   ` +
          `pace ${p.paceIndex === null ? "-" : p.paceIndex.toFixed(2).padStart(5)}   ` +
          `${p.status ?? "UNKNOWN"}`,
      );
      console.log(
        `  day ${p.daysElapsed}/${p.daysInPeriod} (${(p.elapsedFraction * 100).toFixed(1)}% elapsed, ` +
          `${p.daysRemaining} left)   projected finish ${fmt(p.projectedFinish, goal.metric)}   ` +
          `gap ${fmt(p.gapToTarget, goal.metric)}`,
      );
    } else if (shape === "RATIO") {
      const prior = goal.periodStart && goal.periodEnd
        ? priorEquivalentPeriod(goal.periodStart, goal.periodEnd)
        : null;
      const priorResult = prior
        ? await resolveMetric({
            organizationId: orgId,
            metric: goal.metric,
            rangeStart: prior.start,
            rangeEnd: prior.end,
            ownerUserId: goal.ownerUserId,
            period: goal.period,
            goalId: goal.id,
          })
        : null;
      const p = pacingForRatio({
        target,
        actual: result.value,
        priorActual: priorResult?.value ?? null,
      });
      console.log(
        `  vs target ${p.percentDifference === null ? "-" : `${p.percentDifference >= 0 ? "+" : ""}${p.percentDifference.toFixed(1)}%`}   ` +
          `prior period ${fmt(p.priorActual, goal.metric)} (${day(prior?.start ?? null)} -> ${day(prior?.end ?? null)})   ` +
          `trend ${p.trend ?? "-"}   ${p.status ?? "UNKNOWN"}`,
      );
      console.log("  no expected-to-date or projection: an average converges, it does not accumulate");
    } else {
      // MILESTONE
      const trailingStart = new Date(now.getTime() - MILESTONE_RUN_RATE_DAYS * 86_400_000);
      const trailing = await resolveMetric({
        organizationId: orgId,
        metric: goal.metric,
        rangeStart: trailingStart,
        rangeEnd: now,
        ownerUserId: goal.ownerUserId,
        period: goal.period,
        goalId: goal.id,
      });
      const p = pacingForMilestone({
        target,
        actual: result.value,
        trailingWindowActual: trailing.value ?? 0,
        now,
      });
      console.log(
        `  ${p.percentComplete === null ? "-" : `${p.percentComplete.toFixed(1)}% complete`}   ` +
          `remaining ${fmt(p.remaining, goal.metric)}   ` +
          `run rate ${fmt(p.runRatePerDay, goal.metric)}/day over ${MILESTONE_RUN_RATE_DAYS}d`,
      );
      console.log(
        `  projected to land ${p.projectedDate ? day(p.projectedDate) : "-- (run rate is zero)"}` +
          (p.alreadyReached ? "   ALREADY REACHED" : ""),
      );
      console.log("  no pacing: a milestone has no period to be on pace against");
    }

    // ---- Traceable underlying counts ----
    await printTrace(orgId, goal.metric, rangeStart, rangeEnd, goal.ownerUserId, result.revenue);
    console.log("");
  }

  console.log("Read-only. No rows were created, updated or deleted.\n");
}

// The raw records behind each number, so a figure can be checked by hand
// instead of trusted.
async function printTrace(
  orgId: string,
  metric: GoalMetric,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
  revenue: RevenueResult | undefined,
): Promise<void> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const etLabel = `ET window ${start.toISOString()} -> ${endExclusive.toISOString()} (exclusive)`;

  if (metric === GoalMetric.REVENUE || metric === GoalMetric.AVG_DEAL_SIZE) {
    const notCancelled = {
      OR: [{ placementId: null }, { placement: { stage: { not: "cancelled" } } }],
    };
    const owner = ownerUserId ? [{ client: { ownerId: ownerUserId } }] : [];
    const [billedCount, collectedCount, voided, placements] = await Promise.all([
      prisma.invoice.count({
        where: {
          organizationId: orgId,
          status: { in: ["SENT", "PAID"] },
          sentAt: { gte: start, lt: endExclusive },
          AND: [notCancelled, ...owner],
        },
      }),
      prisma.invoice.count({
        where: {
          organizationId: orgId,
          status: "PAID",
          paidAt: { gte: start, lt: endExclusive },
          AND: [notCancelled, ...owner],
        },
      }),
      prisma.invoice.count({
        where: {
          organizationId: orgId,
          status: "VOID",
          sentAt: { gte: start, lt: endExclusive },
        },
      }),
      resolvePlacements(orgId, rangeStart, rangeEnd, ownerUserId),
    ]);
    console.log(
      `  trace: earned ${usd.format(Math.round(revenue?.earned ?? 0))} = sum(Placement.feeTotal) over ${placements} placement(s)`,
    );
    console.log(
      `  trace: billed ${usd.format(Math.round(revenue?.billed ?? 0))} over ${billedCount} invoice(s)  |  ` +
        `collected ${usd.format(Math.round(revenue?.collected ?? 0))} over ${collectedCount} invoice(s)  |  ` +
        `${voided} VOID excluded`,
    );
    console.log(`  trace: ${etLabel}`);
    return;
  }

  if (metric === GoalMetric.SUBMITTALS) {
    const raw = await countRawSubmitActions(orgId, rangeStart, rangeEnd, ownerUserId);
    console.log(`  trace: ${raw} raw ActionLog "submit" row(s), de-duped by candidate + job`);
    console.log(`  trace: ${etLabel}`);
    return;
  }

  if (metric === GoalMetric.PLACEMENTS) {
    const [total, cancelled, rejected] = await Promise.all([
      prisma.placement.count({
        where: { organizationId: orgId, placedAt: { gte: start, lt: endExclusive } },
      }),
      prisma.placement.count({
        where: {
          organizationId: orgId,
          placedAt: { gte: start, lt: endExclusive },
          stage: "cancelled",
        },
      }),
      prisma.placement.count({
        where: {
          organizationId: orgId,
          placedAt: { gte: start, lt: endExclusive },
          stage: "rejected",
        },
      }),
    ]);
    console.log(
      `  trace: ${total} placement(s) with placedAt in window, minus ${cancelled} cancelled + ${rejected} rejected`,
    );
    console.log(`  trace: ${etLabel}`);
    return;
  }

  if (metric === GoalMetric.INTERVIEWS) {
    const [total, cancelled] = await Promise.all([
      prisma.interview.count({
        where: { organizationId: orgId, scheduledAt: { gte: start, lt: endExclusive } },
      }),
      prisma.interview.count({
        where: {
          organizationId: orgId,
          scheduledAt: { gte: start, lt: endExclusive },
          status: "cancelled",
        },
      }),
    ]);
    console.log(`  trace: ${total} interview(s) scheduled in window, minus ${cancelled} cancelled`);
    console.log(`  trace: ${etLabel}`);
    return;
  }

  if (metric === GoalMetric.BD_CONTACTS_ENROLLED) {
    const runs = await prisma.bDRun.count({
      where: { organizationId: orgId, completedAt: { gte: start, lt: endExclusive } },
    });
    console.log(`  trace: summed BDRun.enrolledCount over ${runs} run(s) completed in window`);
    console.log(`  trace: ${etLabel}`);
    return;
  }

  if (metric === GoalMetric.SIGNED_CLIENTS) {
    console.log(`  trace: distinct Client rows with feeAgreementSignedAt in window`);
    console.log(`  trace: ${etLabel}`);
    return;
  }

  console.log(`  trace: ${etLabel}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
