// Unified two-tier time-range model for every dashboard selector.
//
// Supersedes the per-surface period enums (DashboardPeriod, ClubhousePeriod,
// BillingTowerPeriod) with one orthogonal model: a GRAIN (Week / Month /
// Quarter / Year) crossed with a PERIOD (Last / This / Next). `timeRange()`
// resolves any {grain, period} pair to concrete {start, endExclusive} Date
// bounds plus display + eyebrow labels — every downstream Prisma filter
// already uses half-open `gte`/`lt` on those Dates, so the four dashboards
// support arbitrary windows without touching their queries.
//
// Behavior is preserved verbatim from the resolvers this replaces:
//   - WEEK uses the Eastern-Time week helper (Monday 00:00 ET .. next Monday)
//     so the activity strip never flips early on the UTC server.
//   - MONTH / QUARTER / YEAR use local-time Date math (server runs UTC), the
//     same `Math.floor(month / 3) * 3` quarter bucketing the scoreboard,
//     billing tower, invoices, and placements dashboards already share.
//
// Pure module: no React, no DB, no env — safe for both server and client
// component imports.

import { getEasternWeekBounds, formatEasternWeekRange } from "@/lib/week";

export type TimeGrain = "WEEK" | "MONTH" | "QUARTER" | "YEAR";
export type TimePeriod = "LAST" | "THIS" | "NEXT";

export type TimeRangeSelection = { grain: TimeGrain; period: TimePeriod };

export type TimeRangeResult = {
  start: Date;
  endExclusive: Date;
  // Plain window label, e.g. "Q2 2026", "YTD 2026", "May 2026",
  // "Week of May 25-31, 2026", "2025".
  label: string;
  // Activity-strip eyebrow, e.g. "ACTIVITY FOR Q2 2026".
  eyebrow: string;
};

// Canonical default: the current quarter. Matches the legacy
// THIS_QUARTER default the scoreboard / placements / finances pages used.
export const DEFAULT_TIME_RANGE: TimeRangeSelection = {
  grain: "QUARTER",
  period: "THIS",
};

export const TIME_GRAIN_ITEMS: ReadonlyArray<{ id: TimeGrain; label: string }> = [
  { id: "WEEK", label: "Week" },
  { id: "MONTH", label: "Month" },
  { id: "QUARTER", label: "Quarter" },
  { id: "YEAR", label: "Year" },
];

export const TIME_PERIOD_ITEMS: ReadonlyArray<{ id: TimePeriod; label: string }> = [
  { id: "LAST", label: "Last" },
  { id: "THIS", label: "This" },
  { id: "NEXT", label: "Next" },
];

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodOffset(period: TimePeriod): number {
  return period === "LAST" ? -1 : period === "NEXT" ? 1 : 0;
}

export function timeRange(
  sel: TimeRangeSelection,
  now: Date = new Date(),
): TimeRangeResult {
  const { grain, period } = sel;

  if (grain === "WEEK") {
    // Shift the current ET week by whole 7-day steps. Matches the prior
    // LAST_WEEK behavior (this-week Monday minus 7 days), extended to NEXT.
    const { start: thisStart, end: thisEnd } = getEasternWeekBounds(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const shift = periodOffset(period) * 7 * dayMs;
    const start = new Date(thisStart.getTime() + shift);
    const endExclusive = new Date(thisEnd.getTime() + shift);
    const plain = formatEasternWeekRange(start, endExclusive); // "Week of …"
    return {
      start,
      endExclusive,
      label: plain,
      eyebrow: `ACTIVITY FOR ${plain.toUpperCase()}`,
    };
  }

  const year = now.getFullYear();

  if (grain === "MONTH") {
    const base = new Date(year, now.getMonth() + periodOffset(period), 1);
    const start = base;
    const endExclusive = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const label = `${MONTH_FULL[base.getMonth()]} ${base.getFullYear()}`;
    return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label.toUpperCase()}` };
  }

  if (grain === "QUARTER") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const startMonth = currentQuarter * 3 + periodOffset(period) * 3;
    // Date() normalizes negative / >11 months across the year boundary,
    // so Q1 "Last" correctly lands on Q4 of the prior year, etc.
    const start = new Date(year, startMonth, 1);
    const endExclusive = new Date(year, startMonth + 3, 1);
    const qNum = Math.floor(start.getMonth() / 3) + 1;
    const label = `Q${qNum} ${start.getFullYear()}`;
    return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label}` };
  }

  // YEAR. "This" reads as YTD to preserve the existing YTD label + semantics
  // (full calendar year window, labeled year-to-date).
  const y = year + periodOffset(period);
  const start = new Date(y, 0, 1);
  const endExclusive = new Date(y + 1, 0, 1);
  const label = period === "THIS" ? `YTD ${y}` : `${y}`;
  return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label}` };
}

export function encodeTimeRange(sel: TimeRangeSelection): string {
  return `${sel.grain.toLowerCase()}-${sel.period.toLowerCase()}`;
}

export function sameSelection(a: TimeRangeSelection, b: TimeRangeSelection): boolean {
  return a.grain === b.grain && a.period === b.period;
}

const GRAIN_SET = new Set<string>(["WEEK", "MONTH", "QUARTER", "YEAR"]);
const PERIOD_SET = new Set<string>(["LAST", "THIS", "NEXT"]);

// Legacy URL tokens from the enums this model replaces. Keeps bookmarked /
// shared links (?period=YTD, ?cbperiod=THIS_MONTH, billing current/ytd, …)
// working after the migration.
const LEGACY: Record<string, TimeRangeSelection> = {
  YTD: { grain: "YEAR", period: "THIS" },
  THIS_QUARTER: { grain: "QUARTER", period: "THIS" },
  LAST_QUARTER: { grain: "QUARTER", period: "LAST" },
  NEXT_QUARTER: { grain: "QUARTER", period: "NEXT" },
  THIS_WEEK: { grain: "WEEK", period: "THIS" },
  LAST_WEEK: { grain: "WEEK", period: "LAST" },
  THIS_MONTH: { grain: "MONTH", period: "THIS" },
  current: { grain: "QUARTER", period: "THIS" },
  next: { grain: "QUARTER", period: "NEXT" },
  previous: { grain: "QUARTER", period: "LAST" },
  ytd: { grain: "YEAR", period: "THIS" },
};

export function parseTimeRange(
  raw: string | null | undefined,
): TimeRangeSelection | null {
  if (!raw) return null;
  if (LEGACY[raw]) return LEGACY[raw];
  const [g, p] = raw.split("-");
  const grain = (g ?? "").toUpperCase();
  const period = (p ?? "").toUpperCase();
  if (GRAIN_SET.has(grain) && PERIOD_SET.has(period)) {
    return { grain: grain as TimeGrain, period: period as TimePeriod };
  }
  return null;
}

export function resolveTimeRange(
  raw: string | null | undefined,
  fallback: TimeRangeSelection = DEFAULT_TIME_RANGE,
): TimeRangeSelection {
  return parseTimeRange(raw) ?? fallback;
}
