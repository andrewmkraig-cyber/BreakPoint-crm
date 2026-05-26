import { prisma } from "@/lib/prisma";

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

export const QUARTERLY_REVENUE_GOAL_USD = 125_000;
export const ANNUAL_REVENUE_GOAL_USD = 300_000;

type QuarterPacingData = {
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
  quarter: QuarterPacingData;
  annual: AnnualPacingData;
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
// We sum Placement.feeTotal over rows where stage IN (pending_start, hired)
// and (expectedStartDate ?? placedAt) lands inside the window. Same logic
// as the Placements tab's "Billed This Quarter" total (see
// src/lib/placements-dashboard.ts) - Pending Start + Billed + Paid combined,
// not just paid invoices. Previously this card read from
// Invoice.status IN (SENT, PAID) which excluded Pending Start placements
// with no invoice row yet, dragging the goal pacing % below the real number.
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

  const [yearPlacements, placementsYtd] = await Promise.all([
    // Same shape as getPlacementsDashboardData: rows with a locked stage
    // (pending_start or hired) whose start lands inside the window.
    // expectedStartDate is the primary pivot; placedAt is the fallback for
    // rows that have an accepted offer but no committed start date yet, so
    // they don't fall off the year just because the recruiter hasn't typed
    // a start date in.
    prisma.placement.findMany({
      where: {
        organizationId,
        stage: { in: ["pending_start", "hired"] },
        OR: [
          { expectedStartDate: { gte: yearStart, lt: yearEnd } },
          {
            AND: [
              { expectedStartDate: null },
              { placedAt: { gte: yearStart, lt: yearEnd } },
            ],
          },
        ],
      },
      select: { feeTotal: true, expectedStartDate: true, placedAt: true },
    }),
    prisma.placement.count({
      where: {
        organizationId,
        placedAt: { gte: yearStart, lt: yearEnd },
      },
    }),
  ]);

  let ytdRevenueUsd = 0;
  let quarterRevenueUsd = 0;
  for (const p of yearPlacements) {
    const amt = p.feeTotal ?? 0;
    ytdRevenueUsd += amt;
    // Quarter window pivots on the same date the placements tab uses:
    // expectedStartDate when set, placedAt otherwise.
    const ref = p.expectedStartDate ?? p.placedAt;
    if (ref && ref >= qStart && ref < qEnd) {
      quarterRevenueUsd += amt;
    }
  }

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

  const qPctToGoal = (quarterRevenueUsd / QUARTERLY_REVENUE_GOAL_USD) * 100;
  const qToGoUsd = Math.max(0, QUARTERLY_REVENUE_GOAL_USD - quarterRevenueUsd);
  const qPacingPts = qPctToGoal - etPctOfQuarter;
  const qPacingLabel = (() => {
    const rounded = Math.round(Math.abs(qPacingPts));
    if (rounded === 0) return "on pace";
    return qPacingPts >= 0 ? `+${rounded} pts ahead` : `-${rounded} pts behind`;
  })();

  const annualPctToGoal = (ytdRevenueUsd / ANNUAL_REVENUE_GOAL_USD) * 100;
  const annualToGoUsd = Math.max(0, ANNUAL_REVENUE_GOAL_USD - ytdRevenueUsd);
  const annualForecastUsd =
    etDayOfYear > 0 ? (ytdRevenueUsd / etDayOfYear) * etDaysInYear : 0;

  const avgFeeUsd = placementsYtd > 0 ? ytdRevenueUsd / placementsYtd : 0;
  const quarterLabel = `Q${qIndex + 1} ${year}`;

  return {
    quarter: {
      eyebrow: `${quarterLabel.toUpperCase()} · QUARTERLY GOAL`,
      revenueFormatted: formatUsd(quarterRevenueUsd),
      goalFormatted: formatUsd(QUARTERLY_REVENUE_GOAL_USD),
      pctToGoal: qPctToGoal,
      pctToGoalLabel: fmtPctInt(qPctToGoal),
      dayOfQuarter: etDayOfQuarter,
      daysInQuarter: etDaysInQuarter,
      pctOfQuarterLabel: fmtPctInt(etPctOfQuarter),
      toGoFormatted: formatUsd(qToGoUsd),
      pacingLabel: qPacingLabel,
    },
    annual: {
      eyebrow: `FY ${etYear} · ANNUAL GOAL`,
      revenueFormatted: formatUsd(ytdRevenueUsd),
      goalFormatted: formatUsd(ANNUAL_REVENUE_GOAL_USD),
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

      <div className="my-4 h-px bg-court-border-soft" />

      <PacingBlock
        eyebrow={data.annual.eyebrow}
        revenueFormatted={data.annual.revenueFormatted}
        goalFormatted={data.annual.goalFormatted}
        pctToGoal={data.annual.pctToGoal}
        pctToGoalLabel={data.annual.pctToGoalLabel}
        leftFooter={`Day ${data.annual.dayOfYear} of ${data.annual.daysInYear} (${data.annual.pctOfYearLabel} of year)`}
        rightFooter={`${data.annual.toGoFormatted} to goal`}
      />

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
