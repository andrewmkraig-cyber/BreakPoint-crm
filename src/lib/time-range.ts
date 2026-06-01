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
// Legacy 3-value period, retained only so old bookmarked URLs
// (?period=week-last, ?cbperiod=this) still parse. The live model is an
// integer offset: 0 = current period of the grain, -1 = previous,
// +1 = next, -2 = two ago, etc. The ‹ › arrows page that offset with no
// bound (each page may clamp via min/maxOffset on the selector).
export type TimePeriod = "LAST" | "THIS" | "NEXT";

export type TimeRangeSelection = { grain: TimeGrain; offset: number };

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
  offset: 0,
};

export const TIME_GRAIN_ITEMS: ReadonlyArray<{ id: TimeGrain; label: string }> = [
  { id: "WEEK", label: "Week" },
  { id: "MONTH", label: "Month" },
  { id: "QUARTER", label: "Quarter" },
  { id: "YEAR", label: "Year" },
];

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Legacy period token -> offset, for parsing old "grain-period" URLs.
function periodToOffset(period: string): number {
  return period === "LAST" ? -1 : period === "NEXT" ? 1 : 0;
}

export function timeRange(
  sel: TimeRangeSelection,
  now: Date = new Date(),
): TimeRangeResult {
  const { grain, offset } = sel;

  if (grain === "WEEK") {
    // Shift the current ET week by whole 7-day steps. offset 0 = this
    // week, -1 = last week, +N = N weeks out.
    const { start: thisStart, end: thisEnd } = getEasternWeekBounds(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const shift = offset * 7 * dayMs;
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
    const base = new Date(year, now.getMonth() + offset, 1);
    const start = base;
    const endExclusive = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const label = `${MONTH_FULL[base.getMonth()]} ${base.getFullYear()}`;
    return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label.toUpperCase()}` };
  }

  if (grain === "QUARTER") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const startMonth = currentQuarter * 3 + offset * 3;
    // Date() normalizes negative / >11 months across the year boundary,
    // so Q1 offset -1 correctly lands on Q4 of the prior year, etc.
    const start = new Date(year, startMonth, 1);
    const endExclusive = new Date(year, startMonth + 3, 1);
    const qNum = Math.floor(start.getMonth() / 3) + 1;
    const label = `Q${qNum} ${start.getFullYear()}`;
    return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label}` };
  }

  // YEAR. offset 0 reads as YTD to preserve the existing YTD label +
  // semantics (full calendar year window, labeled year-to-date).
  const y = year + offset;
  const start = new Date(y, 0, 1);
  const endExclusive = new Date(y + 1, 0, 1);
  const label = offset === 0 ? `YTD ${y}` : `${y}`;
  return { start, endExclusive, label, eyebrow: `ACTIVITY FOR ${label}` };
}

// Display chrome for the combined time control: a short period eyebrow
// ("THIS WEEK", "LAST QUARTER", "2 MONTHS AGO", "IN 3 WEEKS") over a
// concrete window label ("Jun 1 – 7, 2026", "June 2026", "Q2 2026",
// "YTD 2026"). Computed server-side per page and passed into the
// selector so SSR + hydration agree byte-for-byte.
export function timeRangeChrome(
  sel: TimeRangeSelection,
  now: Date = new Date(),
): { eyebrow: string; rangeLabel: string } {
  const { grain, offset } = sel;
  const r = timeRange(sel, now);
  const rangeLabel =
    grain === "WEEK" ? formatWeekShort(r.start, r.endExclusive) : r.label;

  const G = grain; // "WEEK" | "MONTH" | "QUARTER" | "YEAR"
  let eyebrow: string;
  if (offset === 0) eyebrow = `THIS ${G}`;
  else if (offset === -1) eyebrow = `LAST ${G}`;
  else if (offset === 1) eyebrow = `NEXT ${G}`;
  else if (offset < -1) eyebrow = `${-offset} ${G}S AGO`;
  else eyebrow = `IN ${offset} ${G}S`;
  return { eyebrow, rangeLabel };
}

// "Jun 1 – 7, 2026" (or "May 28 – Jun 3, 2026" across a month boundary).
// start = Monday 00:00 ET, endExclusive = next Monday 00:00 ET; both are
// re-anchored to noon ET so a DST transition can't shift the day shown.
function formatWeekShort(start: Date, endExclusive: Date): string {
  const z = "America/New_York";
  const startA = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const endA = new Date(endExclusive.getTime() - 12 * 60 * 60 * 1000);
  const mo = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: z, month: "short" }).format(d);
  const da = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: z, day: "numeric" }).format(d);
  const yr = new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric" }).format(endA);
  const sM = mo(startA);
  const eM = mo(endA);
  return sM === eM
    ? `${sM} ${da(startA)} – ${da(endA)}, ${yr}`
    : `${sM} ${da(startA)} – ${eM} ${da(endA)}, ${yr}`;
}

export function encodeTimeRange(sel: TimeRangeSelection): string {
  // "grain.offset" e.g. "week.0", "month.-1", "quarter.2".
  return `${sel.grain.toLowerCase()}.${sel.offset}`;
}

export function sameSelection(a: TimeRangeSelection, b: TimeRangeSelection): boolean {
  return a.grain === b.grain && a.offset === b.offset;
}

const GRAIN_SET = new Set<string>(["WEEK", "MONTH", "QUARTER", "YEAR"]);
const PERIOD_SET = new Set<string>(["LAST", "THIS", "NEXT"]);

// Legacy URL tokens from the enums this model replaces. Keeps bookmarked /
// shared links (?period=YTD, ?cbperiod=THIS_MONTH, billing current/ytd, …)
// working after the migration.
const LEGACY: Record<string, TimeRangeSelection> = {
  YTD: { grain: "YEAR", offset: 0 },
  THIS_QUARTER: { grain: "QUARTER", offset: 0 },
  LAST_QUARTER: { grain: "QUARTER", offset: -1 },
  NEXT_QUARTER: { grain: "QUARTER", offset: 1 },
  THIS_WEEK: { grain: "WEEK", offset: 0 },
  LAST_WEEK: { grain: "WEEK", offset: -1 },
  THIS_MONTH: { grain: "MONTH", offset: 0 },
  current: { grain: "QUARTER", offset: 0 },
  next: { grain: "QUARTER", offset: 1 },
  previous: { grain: "QUARTER", offset: -1 },
  ytd: { grain: "YEAR", offset: 0 },
};

export function parseTimeRange(
  raw: string | null | undefined,
): TimeRangeSelection | null {
  if (!raw) return null;
  if (LEGACY[raw]) return LEGACY[raw];

  // Current format: "grain.offset" e.g. "week.0", "quarter.-2".
  if (raw.includes(".")) {
    const [g, o] = raw.split(".");
    const grain = (g ?? "").toUpperCase();
    const offset = Number.parseInt(o ?? "", 10);
    if (GRAIN_SET.has(grain) && Number.isInteger(offset)) {
      return { grain: grain as TimeGrain, offset };
    }
    return null;
  }

  // Legacy format: "grain-period" e.g. "week-this", "month-last".
  const [g, p] = raw.split("-");
  const grain = (g ?? "").toUpperCase();
  const period = (p ?? "").toUpperCase();
  if (GRAIN_SET.has(grain) && PERIOD_SET.has(period)) {
    return { grain: grain as TimeGrain, offset: periodToOffset(period) };
  }
  return null;
}

export function resolveTimeRange(
  raw: string | null | undefined,
  fallback: TimeRangeSelection = DEFAULT_TIME_RANGE,
): TimeRangeSelection {
  return parseTimeRange(raw) ?? fallback;
}
