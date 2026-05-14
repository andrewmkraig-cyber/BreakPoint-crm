// Period helpers for the Clubhouse activity strip. Lives in its own
// (non-"use client") file so my-dashboard.tsx — a server component —
// can call them at render time. The client TabStrip wrapper in
// clubhouse-period-tabs.tsx imports the items / type from here so
// option labels stay in lockstep with the resolver.

import { getEasternWeekBounds, formatEasternWeekRange } from "@/lib/week";

export type ClubhousePeriod =
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_QUARTER"
  | "THIS_QUARTER";

export const CLUBHOUSE_PERIOD_ITEMS: ReadonlyArray<{
  id: ClubhousePeriod;
  label: string;
}> = [
  { id: "THIS_WEEK", label: "This Week" },
  { id: "LAST_WEEK", label: "Last Week" },
  { id: "THIS_MONTH", label: "This Month" },
  { id: "LAST_QUARTER", label: "Last Quarter" },
  { id: "THIS_QUARTER", label: "This Quarter" },
];

export const CLUBHOUSE_PERIOD_PARAM = "cbperiod";

export function resolveClubhousePeriod(
  raw: string | undefined | null,
): ClubhousePeriod {
  if (
    raw === "LAST_WEEK" ||
    raw === "THIS_MONTH" ||
    raw === "LAST_QUARTER" ||
    raw === "THIS_QUARTER"
  ) {
    return raw;
  }
  return "THIS_WEEK";
}

const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Resolve activity-window bounds for the Clubhouse strip. Weeks reuse
// the Eastern-Time helper so the default "This Week" view matches the
// behavior that was hard-coded before the selector existed. Months and
// quarters use local-time Date constructors (server runs UTC) — same
// approach as the Scoreboard period helper, so the two stay aligned.
export function clubhousePeriodRange(
  period: ClubhousePeriod,
  now: Date = new Date(),
): { start: Date; endExclusive: Date; eyebrowLabel: string } {
  if (period === "THIS_WEEK") {
    const { start, end } = getEasternWeekBounds(now);
    const range = formatEasternWeekRange(start, end).replace(/^Week of /, "");
    return {
      start,
      endExclusive: end,
      eyebrowLabel: `ACTIVITY FOR WEEK OF ${range}`.toUpperCase(),
    };
  }
  if (period === "LAST_WEEK") {
    const { start: thisStart } = getEasternWeekBounds(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const start = new Date(thisStart.getTime() - 7 * dayMs);
    const endExclusive = thisStart;
    const range = formatEasternWeekRange(start, endExclusive).replace(
      /^Week of /,
      "",
    );
    return {
      start,
      endExclusive,
      eyebrowLabel: `ACTIVITY FOR WEEK OF ${range}`.toUpperCase(),
    };
  }
  const year = now.getFullYear();
  if (period === "THIS_MONTH") {
    const month = now.getMonth();
    return {
      start: new Date(year, month, 1),
      endExclusive: new Date(year, month + 1, 1),
      eyebrowLabel: `ACTIVITY FOR ${MONTH_FULL[month].toUpperCase()} ${year}`,
    };
  }
  const currentQuarter = Math.floor(now.getMonth() / 3);
  if (period === "LAST_QUARTER") {
    const startMonth = currentQuarter * 3 - 3;
    const startYear = startMonth < 0 ? year - 1 : year;
    const m = ((startMonth % 12) + 12) % 12;
    const qNum = Math.floor(m / 3) + 1;
    return {
      start: new Date(startYear, m, 1),
      endExclusive: new Date(startYear, m + 3, 1),
      eyebrowLabel: `ACTIVITY FOR Q${qNum} ${startYear}`,
    };
  }
  // THIS_QUARTER
  const startMonth = currentQuarter * 3;
  const qNum = currentQuarter + 1;
  return {
    start: new Date(year, startMonth, 1),
    endExclusive: new Date(year, startMonth + 3, 1),
    eyebrowLabel: `ACTIVITY FOR Q${qNum} ${year}`,
  };
}
