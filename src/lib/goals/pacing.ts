// Pacing: is a goal on track?
//
// THREE SHAPES, DELIBERATELY NOT ONE. Forcing them together is what makes
// goal dashboards lie:
//
//   CUMULATIVE - the target accumulates (revenue, placements, submittals).
//                Half the quarter gone should mean half the number in.
//                Expected-to-date and a linear projection both mean
//                something here.
//   RATIO      - the target is an average (AVG_DEAL_SIZE). An average
//                CONVERGES, it does not accumulate: on day two of a
//                quarter one $20k placement makes the average $20k, and
//                "expected to date" would be nonsense. So this shape has
//                no expectedToDate and no projection - it compares the
//                current average to the target and to the prior period
//                for direction.
//   MILESTONE  - no period at all, so there is nothing to be on pace
//                against. It reports how far along it is and, from the
//                trailing 90-day run rate, roughly when it lands.
//
// Pure functions: every input is passed in, nothing here queries. That
// keeps the whole engine unit-testable without a database, and keeps the
// period arithmetic in one place (see `priorEquivalentPeriod`).
import { GoalMetric, GoalPeriod } from "@prisma/client";

// Day maths from the pure module so this file never drags prisma into a
// bundle; only the RevenueResult TYPE comes from metrics.ts, and a type
// import is erased at build time.
import {
  etDaysInclusive,
  etWindow,
  shiftUtcMarker,
  utcMarkerDaysInclusive,
} from "@/lib/goals/et-window";
import type { RevenueResult } from "@/lib/goals/metrics";

// Shared status bands. Applied to paceIndex for CUMULATIVE and to
// current/target for RATIO. Null when the ratio is undefined (a zero
// target, or nothing measured yet) - "unknown" is not "Behind".
export type PacingStatus = "AHEAD" | "ON_PACE" | "BEHIND";

export const AHEAD_AT = 1.05;
export const BEHIND_BELOW = 0.95;

export function statusFor(ratio: number | null): PacingStatus | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio >= AHEAD_AT) return "AHEAD";
  if (ratio < BEHIND_BELOW) return "BEHIND";
  return "ON_PACE";
}

export type PacingShape = "CUMULATIVE" | "RATIO" | "MILESTONE";

// AVG_DEAL_SIZE is checked BEFORE the period, so an all-time average is
// still treated as a ratio rather than as a milestone. Every other metric
// with no period is a milestone; everything else accumulates.
export function pacingShapeFor(metric: GoalMetric, period: GoalPeriod): PacingShape {
  if (metric === GoalMetric.AVG_DEAL_SIZE) return "RATIO";
  if (period === GoalPeriod.MILESTONE) return "MILESTONE";
  return "CUMULATIVE";
}

// ---------------------------------------------------------------------
// CUMULATIVE
// ---------------------------------------------------------------------

export type CumulativePacing = {
  readonly shape: "CUMULATIVE";
  readonly target: number;
  readonly actual: number;
  readonly daysInPeriod: number;
  readonly daysElapsed: number;
  readonly daysRemaining: number;
  readonly elapsedFraction: number;
  readonly expectedToDate: number;
  // actual / expectedToDate. Null when expectedToDate is 0 (a zero target,
  // or a period that has not started).
  readonly paceIndex: number | null;
  // Where this lands if the current rate holds. Null before the period
  // starts, and for a zero-length elapsed fraction.
  readonly projectedFinish: number | null;
  // Positive means still to go; negative means past target.
  readonly gapToTarget: number;
  readonly status: PacingStatus | null;
  // REVENUE goals only. `actual` above is the BILLED figure and that is
  // what everything paces on; earned and collected ride along purely for
  // display, so a card can show all three tiers without a second query.
  readonly revenue?: RevenueResult;
};

export function pacingForCumulative(input: {
  target: number;
  actual: number;
  periodStart: Date;
  periodEnd: Date;
  now?: Date;
  // Passed through untouched for REVENUE goals. It never changes the
  // pacing maths - the headline stays billed.
  revenue?: RevenueResult;
}): CumulativePacing {
  const { target, actual, periodStart, periodEnd, revenue } = input;
  const now = input.now ?? new Date();

  // periodStart / periodEnd arrive as UTC calendar-date markers. Resolve
  // them to real ET instants FIRST, then do every day count against those.
  // Counting markers against `now` (a true instant) directly would mix two
  // different clocks and drift by a day across a DST boundary.
  const { start, endExclusive } = etWindow(periodStart, periodEnd);
  const lastInstant = new Date(endExclusive.getTime() - 1);

  const daysInPeriod = Math.max(1, etDaysInclusive(start, lastInstant));

  // Day one of the period is day 1, not day 0 - a recruiter on the first
  // morning of a quarter is 1/91 of the way in, not 0/91. That is also
  // what keeps elapsedFraction non-zero and the projection defined from
  // the very first day. Before the period opens, 0 days have elapsed and
  // both the pace index and the projection are left undefined rather than
  // being computed from a divide by zero.
  const rawElapsed = etDaysInclusive(start, now);
  const daysElapsed = Math.min(Math.max(rawElapsed, 0), daysInPeriod);
  const daysRemaining = daysInPeriod - daysElapsed;
  const elapsedFraction = daysElapsed / daysInPeriod;

  const expectedToDate = target * elapsedFraction;
  const paceIndex = expectedToDate > 0 ? actual / expectedToDate : null;
  const projectedFinish = elapsedFraction > 0 ? actual / elapsedFraction : null;

  return {
    shape: "CUMULATIVE",
    target,
    actual,
    daysInPeriod,
    daysElapsed,
    daysRemaining,
    elapsedFraction,
    expectedToDate,
    paceIndex,
    projectedFinish,
    gapToTarget: target - actual,
    status: statusFor(paceIndex),
    ...(revenue ? { revenue } : {}),
  };
}

// ---------------------------------------------------------------------
// RATIO
// ---------------------------------------------------------------------

export type RatioTrend = "UP" | "DOWN" | "FLAT";

export type RatioPacing = {
  readonly shape: "RATIO";
  readonly target: number;
  // The current average. Null when there is nothing to average yet -
  // NOT zero, which would read as "our deals are worthless".
  readonly actual: number | null;
  // How far above or below target, as a percentage. Null when either side
  // is missing.
  readonly percentDifference: number | null;
  // The same average over the immediately prior equivalent period.
  readonly priorActual: number | null;
  readonly trend: RatioTrend | null;
  readonly status: PacingStatus | null;
};

// No expectedToDate and no projectedFinish on purpose - see the header.
export function pacingForRatio(input: {
  target: number;
  actual: number | null;
  priorActual: number | null;
}): RatioPacing {
  const { target, actual, priorActual } = input;

  const ratio = actual !== null && target > 0 ? actual / target : null;
  const percentDifference =
    actual !== null && target > 0 ? ((actual - target) / target) * 100 : null;

  let trend: RatioTrend | null = null;
  if (actual !== null && priorActual !== null) {
    if (actual > priorActual) trend = "UP";
    else if (actual < priorActual) trend = "DOWN";
    else trend = "FLAT";
  }

  return {
    shape: "RATIO",
    target,
    actual,
    percentDifference,
    priorActual,
    trend,
    status: statusFor(ratio),
  };
}

// The window immediately before [periodStart, periodEnd], of the same
// length in ET days. Q2 -> Q1, this month -> last month. Callers resolve
// the metric over this to get `priorActual`.
// Returned in the same form the bounds came in - UTC calendar-date markers -
// so the result can be handed straight back to a metric resolver, which
// re-anchors it to ET. Computed in marker space so a DST change inside
// either window cannot make the prior period a day longer or shorter.
export function priorEquivalentPeriod(
  periodStart: Date,
  periodEnd: Date,
): { start: Date; end: Date } {
  const days = Math.max(1, utcMarkerDaysInclusive(periodStart, periodEnd));
  const end = shiftUtcMarker(periodStart, -1);
  return { start: shiftUtcMarker(end, -(days - 1)), end };
}

// ---------------------------------------------------------------------
// MILESTONE
// ---------------------------------------------------------------------

export const MILESTONE_RUN_RATE_DAYS = 90;

export type MilestonePacing = {
  readonly shape: "MILESTONE";
  readonly target: number;
  readonly actual: number;
  // Null when the target is 0.
  readonly percentComplete: number | null;
  // Units per day over the trailing 90 days.
  readonly runRatePerDay: number;
  readonly remaining: number;
  readonly alreadyReached: boolean;
  // When the target lands at the trailing run rate. Null when the run
  // rate is zero (nothing is moving, so there is no honest date to give)
  // or when the target is already reached.
  readonly projectedDate: Date | null;
};

export function pacingForMilestone(input: {
  target: number;
  actual: number;
  // Whatever accrued in the trailing 90 days, resolved by the caller.
  trailingWindowActual: number;
  trailingWindowDays?: number;
  now?: Date;
}): MilestonePacing {
  const { target, actual, trailingWindowActual } = input;
  const now = input.now ?? new Date();
  const windowDays = Math.max(1, input.trailingWindowDays ?? MILESTONE_RUN_RATE_DAYS);

  const percentComplete = target > 0 ? (actual / target) * 100 : null;
  const remaining = target - actual;
  const alreadyReached = remaining <= 0;
  const runRatePerDay = trailingWindowActual / windowDays;

  let projectedDate: Date | null = null;
  if (!alreadyReached && runRatePerDay > 0) {
    const daysOut = remaining / runRatePerDay;
    projectedDate = new Date(now.getTime() + daysOut * 86_400_000);
  }

  return {
    shape: "MILESTONE",
    target,
    actual,
    percentComplete,
    runRatePerDay,
    remaining,
    alreadyReached,
    projectedDate,
  };
}

export type PacingResult = CumulativePacing | RatioPacing | MilestonePacing;
