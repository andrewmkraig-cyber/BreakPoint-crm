import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { resolveRevenue } from "@/lib/goals/metrics";

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

// LEGACY HARDCODED TARGETS - no longer used by this card.
//
// The Goal Pacing card now reads its targets from the Goal table (Ace 99.0)
// so there is one place a revenue target is set. These constants remain
// ONLY because two other surfaces still import them:
//   - src/app/dashboard/billing-tower-actions.ts (Billing Tower goal)
//   - src/components/finances/revenue-cards.tsx  (TrendCard subtitle)
// Both were deliberately left unchanged in Ace 99.0 so no other dashboard
// surface moved in that pass; pointing them at the Goal table is an open
// follow-up in ACE_ROADMAP.md. Until then they can disagree with this card -
// the annual constant reads 300k while the live 2026 ANNUAL goal is 500k.
// Do NOT add new consumers.
export const QUARTERLY_REVENUE_GOAL_USD = 125_000;
export const ANNUAL_REVENUE_GOAL_USD = 300_000;

// A pacing block with no matching goal row renders the "no goal set"
// state instead of falling back to a number nobody chose.
type NoGoal = { hasGoal: false; eyebrow: string };

type QuarterPacingData = {
  hasGoal: true;
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  dayOfQuarter: number;
  daysInQuarter: number;
  pctOfQuarterLabel: string;
  toGoFormatted: string;
  pacingLabel: string;
};

type AnnualPacingData = {
  hasGoal: true;
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  dayOfYear: number;
  daysInYear: number;
  pctOfYearLabel: string;
  toGoFormatted: string;
  forecastFormatted: string;
};

export type GoalPacingCardData = {
  quarter: QuarterPacingData | NoGoal;
  annual: AnnualPacingData | NoGoal;
  avgFeeFormatted: string;
  placementsYtd: number;
};

// Org-scoped pull of YTD revenue + current-quarter revenue + placement
// count so the card stays internally consistent no matter which surface
// renders it (Scoreboard or Finances Profitability). Vercel runs in UTC;
// day-of-quarter and day-of-year are computed from explicit ET parts so
// the counter ticks at midnight ET, not 8pm.
//
// Revenue source (Ace fix 2026-05-26): BILLED revenue, not collected.
// Sums billing events for placements in (pending_start, hired), bucketed
// by event scheduledAt — invoice rows by dueDate, custom-terms
// installments by start+instNDays, and feeTotal-only placements by
// expectedStartDate/placedAt. This is what fixes custom-terms placements
// without Invoice rows yet (Ethan): inst1 lands in Q2, inst2 lands in
// Q3, instead of his whole feeTotal (null) reading $0 for both quarters.
// Per-quarter pacing now tracks the recruiter's intent ("I billed
// $3,750 worth of Ethan in Q2") not just whatever Placement.feeTotal
// happens to be on the row.
export async function getGoalPacingData(
  organizationId: string,
  now: Date = new Date(),
): Promise<GoalPacingCardData> {
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const qIndex = Math.floor(now.getMonth() / 3);
  const qStart = new Date(year, qIndex * 3, 1);
  const qEnd = new Date(year, qIndex * 3 + 3, 1);

  // The billing-event placement query and the retained-invoice query that
  // used to sit here were deleted in Ace 99.0 when this card moved onto the
  // goals engine's `earned` tier. `resolveRevenue` does that work now, with
  // the same exclusions every other goals surface uses.
  const [placementsYtd] = await Promise.all([
    prisma.placement.count({
      // YTD Placements counter for Goal Pacing — cancelled placements
      // are dropped so the count matches the booked-revenue ledger
      // assembled above (which already whitelists pending_start/hired).
      where: {
        organizationId,
        placedAt: { gte: yearStart, lt: yearEnd },
        stage: { not: "cancelled" },
      },
    }),
  ]);

  // ACTUALS COME FROM THE GOALS ENGINE (Ace 99.0), on the EARNED tier.
  //
  // This card used to compute its own billed figure from billing events
  // (expandPlacementBillingEvents bucketed by scheduledAt), which is a
  // THIRD definition of revenue alongside the engine's earned and billed.
  // Andrew settled it on 2026-09-01: a deal counts when it CLOSES, not
  // when it is invoiced. Reading resolveRevenue here means this card and
  // the Goals tab can no longer disagree - same window, same query, same
  // exclusions (cancelled + rejected out, retained placements out of
  // earned because their money is on the retained invoice).
  //
  // Windows are converted to UTC calendar-date MARKERS because that is
  // what the engine's etWindow expects; handing it the local-time instants
  // above would re-anchor the wrong calendar day.
  const asMarker = (d: Date) =>
    new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const lastDayOf = (endExclusive: Date) =>
    asMarker(new Date(endExclusive.getTime() - 1));

  const [yearRevenue, quarterRevenue] = await Promise.all([
    resolveRevenue(organizationId, asMarker(yearStart), lastDayOf(yearEnd), null),
    resolveRevenue(organizationId, asMarker(qStart), lastDayOf(qEnd), null),
  ]);
  const ytdRevenueUsd = yearRevenue.earned;
  const quarterRevenueUsd = quarterRevenue.earned;

  const ET_DAY_MS = 86_400_000;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const etGet = (t: string) =>
    Number(etParts.find((p) => p.type === t)?.value ?? 0);
  const etYear = etGet("year");
  const etMonth = etGet("month");
  const etDay = etGet("day");
  const etQStartMonth1 = Math.floor((etMonth - 1) / 3) * 3 + 1;
  const etDayOfQuarter =
    Math.floor(
      (Date.UTC(etYear, etMonth - 1, etDay) -
        Date.UTC(etYear, etQStartMonth1 - 1, 1)) /
        ET_DAY_MS,
    ) + 1;
  const etDaysInQuarter = Math.round(
    (Date.UTC(etYear, etQStartMonth1 + 2, 1) -
      Date.UTC(etYear, etQStartMonth1 - 1, 1)) /
      ET_DAY_MS,
  );
  const etDayOfYear =
    Math.floor(
      (Date.UTC(etYear, etMonth - 1, etDay) - Date.UTC(etYear, 0, 1)) /
        ET_DAY_MS,
    ) + 1;
  const etDaysInYear = Math.round(
    (Date.UTC(etYear + 1, 0, 1) - Date.UTC(etYear, 0, 1)) / ET_DAY_MS,
  );
  const etPctOfQuarter = (etDayOfQuarter / etDaysInQuarter) * 100;
  const etPctOfYear = (etDayOfYear / etDaysInYear) * 100;

  const fmtPctInt = (n: number) => `${Math.round(n)}%`;

  // TARGETS COME FROM THE GOAL TABLE (Ace 99.0), not from a constant.
  // Matched marker-against-marker: Goal.periodStart / periodEnd are UTC
  // calendar-date markers, so they are compared against the quarter's and
  // year's own markers rather than against the local-time instants above.
  // (Comparing a marker to an instant is what put Q3 inside the Q2 goal on
  // a non-UTC clock earlier in this arc.)
  const qStartMarker = new Date(Date.UTC(year, qIndex * 3, 1));
  const yStartMarker = new Date(Date.UTC(etYear, 0, 1));
  const revenueGoals = await prisma.goal.findMany({
    where: {
      organizationId,
      metric: "REVENUE",
      status: "ACTIVE",
      period: { in: ["QUARTERLY", "ANNUAL"] },
    },
    select: { period: true, targetValue: true, periodStart: true, periodEnd: true },
  });
  const goalTargetFor = (
    period: "QUARTERLY" | "ANNUAL",
    marker: Date,
  ): number | null => {
    const hit = revenueGoals.find(
      (g) =>
        g.period === period &&
        g.periodStart != null &&
        g.periodEnd != null &&
        marker >= g.periodStart &&
        marker <= g.periodEnd,
    );
    return hit ? Number(hit.targetValue) : null;
  };
  const quarterTargetUsd = goalTargetFor("QUARTERLY", qStartMarker);
  const annualTargetUsd = goalTargetFor("ANNUAL", yStartMarker);

  const quarterLabelForEyebrow = `Q${qIndex + 1} ${year}`;
  if (quarterTargetUsd == null || annualTargetUsd == null) {
    // Fall through to the per-block no-goal states below rather than
    // inventing a number. Handled after both are computed.
  }

  const qPctToGoal = quarterTargetUsd ? (quarterRevenueUsd / quarterTargetUsd) * 100 : 0;
  const qToGoUsd = Math.max(0, (quarterTargetUsd ?? 0) - quarterRevenueUsd);
  const qPacingPts = qPctToGoal - etPctOfQuarter;
  const qPacingLabel = (() => {
    const rounded = Math.round(Math.abs(qPacingPts));
    if (rounded === 0) return "on pace";
    return qPacingPts >= 0 ? `+${rounded} pts ahead` : `-${rounded} pts behind`;
  })();

  const annualPctToGoal = annualTargetUsd ? (ytdRevenueUsd / annualTargetUsd) * 100 : 0;
  const annualToGoUsd = Math.max(0, (annualTargetUsd ?? 0) - ytdRevenueUsd);
  const annualForecastUsd =
    etDayOfYear > 0 ? (ytdRevenueUsd / etDayOfYear) * etDaysInYear : 0;

  const avgFeeUsd = placementsYtd > 0 ? ytdRevenueUsd / placementsYtd : 0;
  const quarterLabel = `Q${qIndex + 1} ${year}`;

  return {
    quarter: quarterTargetUsd == null
      ? { hasGoal: false as const, eyebrow: `${quarterLabelForEyebrow.toUpperCase()} · QUARTERLY GOAL` }
      : {
      hasGoal: true as const,
      eyebrow: `${quarterLabel.toUpperCase()} · QUARTERLY GOAL`,
      revenueFormatted: formatUsd(quarterRevenueUsd),
      goalFormatted: formatUsd(quarterTargetUsd),
      pctToGoal: qPctToGoal,
      pctToGoalLabel: fmtPctInt(qPctToGoal),
      dayOfQuarter: etDayOfQuarter,
      daysInQuarter: etDaysInQuarter,
      pctOfQuarterLabel: fmtPctInt(etPctOfQuarter),
      toGoFormatted: formatUsd(qToGoUsd),
      pacingLabel: qPacingLabel,
    },
    annual: annualTargetUsd == null
      ? { hasGoal: false as const, eyebrow: `FY ${etYear} · ANNUAL GOAL` }
      : {
      hasGoal: true as const,
      eyebrow: `FY ${etYear} · ANNUAL GOAL`,
      revenueFormatted: formatUsd(ytdRevenueUsd),
      goalFormatted: formatUsd(annualTargetUsd),
      pctToGoal: annualPctToGoal,
      pctToGoalLabel: fmtPctInt(annualPctToGoal),
      dayOfYear: etDayOfYear,
      daysInYear: etDaysInYear,
      pctOfYearLabel: fmtPctInt(etPctOfYear),
      toGoFormatted: formatUsd(annualToGoUsd),
      forecastFormatted: formatUsd(annualForecastUsd),
    },
    avgFeeFormatted: formatUsd(avgFeeUsd),
    placementsYtd,
  };
}

export function GoalPacingCard({ data }: { data: GoalPacingCardData }) {
  return (
    <div className="flex flex-col rounded-2xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div>
        <p className="font-serif text-sm font-bold tracking-tight text-court-fg">
          Goal pacing
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Where the desk sits vs plan
        </p>
      </div>

      {data.quarter.hasGoal ? (
        <PacingBlock
          eyebrow={data.quarter.eyebrow}
          revenueFormatted={data.quarter.revenueFormatted}
          goalFormatted={data.quarter.goalFormatted}
          pctToGoal={data.quarter.pctToGoal}
          pctToGoalLabel={data.quarter.pctToGoalLabel}
          leftFooter={`Day ${data.quarter.dayOfQuarter} of ${data.quarter.daysInQuarter} (${data.quarter.pctOfQuarterLabel} of quarter)`}
          rightFooter={`${data.quarter.toGoFormatted} to goal`}
          className="mt-4"
        />
      ) : (
        <NoGoalBlock eyebrow={data.quarter.eyebrow} className="mt-4" />
      )}

      <div className="my-4 h-px bg-court-border-soft" />

      {data.annual.hasGoal ? (
        <PacingBlock
          eyebrow={data.annual.eyebrow}
          revenueFormatted={data.annual.revenueFormatted}
          goalFormatted={data.annual.goalFormatted}
          pctToGoal={data.annual.pctToGoal}
          pctToGoalLabel={data.annual.pctToGoalLabel}
          leftFooter={`Day ${data.annual.dayOfYear} of ${data.annual.daysInYear} (${data.annual.pctOfYearLabel} of year)`}
          rightFooter={`${data.annual.toGoFormatted} to goal`}
        />
      ) : (
        <NoGoalBlock eyebrow={data.annual.eyebrow} />
      )}

      <p className="mt-4 border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        Avg fee {data.avgFeeFormatted} · {data.placementsYtd} placement
        {data.placementsYtd === 1 ? "" : "s"} YTD
      </p>
    </div>
  );
}

function PacingBlock({
  eyebrow,
  revenueFormatted,
  goalFormatted,
  pctToGoal,
  pctToGoalLabel,
  leftFooter,
  rightFooter,
  className,
}: {
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  leftFooter: string;
  rightFooter: string;
  className?: string;
}) {
  const barWidth = Math.max(0, Math.min(100, pctToGoal));
  return (
    <div className={className}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        {eyebrow}
      </p>
      <p className="mt-2 font-serif text-[20px] font-bold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
        {revenueFormatted}
      </p>
      <p className="mt-1 text-xs text-court-fg-muted">
        of {goalFormatted} · {pctToGoalLabel} to goal
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className="h-full rounded-full bg-court-brand"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-court-fg-muted">
        <span>{leftFooter}</span>
        <span className="text-right">{rightFooter}</span>
      </div>
    </div>
  );
}

// Rendered when no ACTIVE REVENUE goal covers this window. Deliberately NOT
// a fallback number: a hardcoded target nobody chose is worse than an
// honest gap, because it reads as a real plan the desk is being measured
// against. Links to where the target is actually set.
function NoGoalBlock({ eyebrow, className }: { eyebrow: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        {eyebrow}
      </p>
      <p className="mt-2 text-[13px] text-court-fg-muted">No goal set.</p>
      <Link
        href="/dashboard?tab=goals"
        className="mt-1 inline-block text-xs font-semibold text-court-brand hover:underline"
      >
        Set one on the Goals tab
      </Link>
    </div>
  );
}
