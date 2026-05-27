import { prisma } from "@/lib/prisma";
import {
  BILLING_EVENT_PLACEMENT_SELECT,
  expandPlacementBillingEvents,
  type PlacementForBilling,
} from "@/lib/billing-events";

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

  const [yearPlacements, placementsYtd] = await Promise.all([
    // Rows with a locked stage (pending_start or hired) where ANY billing
    // event might land in the year window. We don't pre-filter by
    // expectedStartDate/placedAt at the query level any more because a
    // custom-terms inst3 might be scheduled for next year even if the
    // placement's expectedStartDate is in this one (or vice-versa).
    // Year-bucket filtering happens after expandPlacementBillingEvents
    // below — open-stage placement counts are small enough that pulling
    // the wider set is fine.
    prisma.placement.findMany({
      where: {
        organizationId,
        stage: { in: ["pending_start", "hired"] },
        OR: [
          { expectedStartDate: { gte: yearStart, lt: yearEnd } },
          { placedAt: { gte: yearStart, lt: yearEnd } },
          { startConfirmedAt: { gte: yearStart, lt: yearEnd } },
        ],
      },
      select: BILLING_EVENT_PLACEMENT_SELECT,
    }),
    prisma.placement.count({
      where: {
        organizationId,
        placedAt: { gte: yearStart, lt: yearEnd },
      },
    }),
  ]);

  let ytdRevenueCents = 0;
  let quarterRevenueCents = 0;
  for (const p of yearPlacements) {
    for (const e of expandPlacementBillingEvents(p as PlacementForBilling)) {
      // Goal Pacing buckets by scheduledAt for every status — even
      // paid events should land in the quarter they were billed for,
      // not the quarter they were collected in. The recruiter's read
      // is "did I earn enough work this quarter to hit goal?", not
      // "did the cash arrive?".
      if (e.scheduledAt >= yearStart && e.scheduledAt < yearEnd) {
        ytdRevenueCents += e.amountCents;
      }
      if (e.scheduledAt >= qStart && e.scheduledAt < qEnd) {
        quarterRevenueCents += e.amountCents;
      }
    }
  }
  const ytdRevenueUsd = ytdRevenueCents / 100;
  const quarterRevenueUsd = quarterRevenueCents / 100;

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
