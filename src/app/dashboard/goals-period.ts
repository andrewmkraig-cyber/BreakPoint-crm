// Period resolver for the Goals tab.
//
// WHY THIS IS GOALS-LOCAL AND NOT AN EXTENSION OF @/lib/time-range.
// Goals needs a DAY grain; the shared model is WEEK | MONTH | QUARTER |
// YEAR. Adding DAY to `TimeGrain` would put it into `TIME_GRAIN_ITEMS`,
// which `TimeRangeSelector` maps over unfiltered - so a new "Day" pill
// would immediately appear on Scoreboard, Placements, Clubhouse and the
// KPI detail dialog. Suppressing it there means passing a `grains` prop
// into each of those call sites, which is exactly the "do not modify how
// any existing page resolves its period" line. So Goals keeps its own
// grain union and its own URL param.
//
// It is a WRAPPER, not a fork: WEEK / MONTH / QUARTER / YEAR delegate
// straight to the shared `timeRange()` so the four grains Goals shares
// with the rest of the app resolve through one implementation and cannot
// drift. Only DAY is computed here, and it uses the same ET anchoring the
// goals engine uses everywhere else.
// MUST come from the pure module, not from metrics.ts: this file is
// imported by the CLIENT period selector, and metrics.ts pulls in prisma.
import { etWindow } from "@/lib/goals/et-window";
import { timeRange, type TimeGrain } from "@/lib/time-range";

export type GoalsGrain = "DAY" | TimeGrain;

export type GoalsPeriodSelection = { grain: GoalsGrain; offset: number };

// Its own param key, the same way Clubhouse keeps `cbperiod` separate from
// the `period` that Placements and Metrics share. Goals can then sit at
// Quarter while Metrics sits at Year without either resetting the other.
export const GOALS_PERIOD_PARAM = "gperiod";

export const DEFAULT_GOALS_PERIOD: GoalsPeriodSelection = {
  grain: "QUARTER",
  offset: 0,
};

export const GOALS_GRAIN_ITEMS: ReadonlyArray<{ id: GoalsGrain; label: string }> = [
  { id: "DAY", label: "Day" },
  { id: "WEEK", label: "Week" },
  { id: "MONTH", label: "Month" },
  { id: "QUARTER", label: "Quarter" },
  { id: "YEAR", label: "Year" },
];

const GRAIN_IDS = new Set<string>(GOALS_GRAIN_ITEMS.map((g) => g.id));

export type GoalsPeriodResult = {
  // Absolute instants, half-open, matching every other window in the app.
  start: Date;
  endExclusive: Date;
  // Inclusive UTC calendar-date markers, the form the goals metric
  // resolvers expect (see the etWindow contract in metrics.ts).
  rangeStart: Date;
  rangeEnd: Date;
  label: string;
};

// Turning a resolved instant back into a UTC calendar-date MARKER.
//
// This has to read the instant in the SAME FRAME it was constructed in, or
// the calendar date shifts on any server whose clock is not UTC:
//   - timeRange() builds MONTH / QUARTER / YEAR from `new Date(y, m, 1)`,
//     i.e. server-LOCAL midnight. Read those back with local getters.
//   - timeRange() builds WEEK from getEasternWeekBounds, i.e. ET midnight
//     as an absolute instant. Read that back with ET parts.
// Mixing the two is what put Q3 2026 at 2026-06-30T21:00Z on a UTC+3
// clock, which then matched the Q2 goal. Vercel runs UTC so it would not
// have shown there, which is exactly why it is pinned down here.
function localMarkerOf(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function etMarkerOf(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

export function goalsPeriod(
  sel: GoalsPeriodSelection,
  now: Date = new Date(),
): GoalsPeriodResult {
  if (sel.grain === "DAY") {
    // Which ET calendar day is `now` in, shifted by the offset? Built from
    // ET parts so the day flips at ET midnight, not at 8pm on the UTC
    // server.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const marker = new Date(
      Date.UTC(get("year"), get("month") - 1, get("day") + sel.offset),
    );
    const { start, endExclusive } = etWindow(marker, marker);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(start);
    return { start, endExclusive, rangeStart: marker, rangeEnd: marker, label };
  }

  const shared = timeRange({ grain: sel.grain, offset: sel.offset }, now);
  // The shared resolver returns a half-open [start, endExclusive). The
  // metric resolvers want INCLUSIVE calendar-date markers, so the last day
  // is one millisecond back from the exclusive end.
  const lastDay = new Date(shared.endExclusive.getTime() - 1);
  const markerOf = sel.grain === "WEEK" ? etMarkerOf : localMarkerOf;
  return {
    start: shared.start,
    endExclusive: shared.endExclusive,
    rangeStart: markerOf(shared.start),
    rangeEnd: markerOf(lastDay),
    label: shared.label,
  };
}

// Parses `?gperiod=quarter.0`. Unknown or malformed values fall back to
// the default rather than throwing, so a hand-edited URL cannot 500 the
// page.
export function resolveGoalsPeriod(
  raw: string | undefined | null,
): GoalsPeriodSelection {
  if (!raw) return DEFAULT_GOALS_PERIOD;
  const [grainRaw, offsetRaw] = raw.split(".");
  const grain = grainRaw?.toUpperCase();
  if (!grain || !GRAIN_IDS.has(grain)) return DEFAULT_GOALS_PERIOD;
  const offset = Number(offsetRaw ?? "0");
  return {
    grain: grain as GoalsGrain,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

export function encodeGoalsPeriod(sel: GoalsPeriodSelection): string {
  return `${sel.grain.toLowerCase()}.${sel.offset}`;
}
