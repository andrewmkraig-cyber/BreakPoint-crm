// Pure ET window + calendar-day helpers for the goals engine.
//
// WHY THIS IS ITS OWN MODULE. These functions have no database access, but
// they used to live in metrics.ts, which imports `@/lib/prisma`. The Goals
// period selector is a CLIENT component and reaches `etWindow` through
// src/app/dashboard/goals-period.ts, so importing them from metrics.ts
// dragged PrismaClient into the browser bundle and threw
// "PrismaClient is unable to run in this browser environment" on
// /dashboard in production (Sentry ACE-CRM-1Y, 2026-09-01).
//
// Nothing in this file may import prisma, @prisma/client, or anything that
// does. src/lib/timezone.ts is pure by design and is the only dependency.
//
// metrics.ts re-exports every symbol here, so server-side imports of
// `@/lib/goals/metrics` keep working unchanged.
import { DEFAULT_TIMEZONE, zonedWallTimeToUtc } from "@/lib/timezone";

export type MetricWindow = {
  // ET midnight of the window's first day, as an absolute instant.
  readonly start: Date;
  // ET midnight of the day AFTER the window's last day. EXCLUSIVE, so
  // every query below is `gte: start, lt: endExclusive` and no row can
  // fall in two adjacent periods.
  readonly endExclusive: Date;
};

function utcCalendarDate(d: Date): { y: number; m: number; day: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// The absolute instant at which the given ET calendar date begins.
function etMidnight(y: number, m: number, day: number): Date {
  return zonedWallTimeToUtc(y, m, day, 0, 0, DEFAULT_TIMEZONE);
}

export function etWindow(rangeStart: Date, rangeEnd: Date): MetricWindow {
  const s = utcCalendarDate(rangeStart);
  const e = utcCalendarDate(rangeEnd);
  // Date.UTC normalizes the day overflow (Dec 31 + 1 -> Jan 1).
  const dayAfterEnd = new Date(Date.UTC(e.y, e.m - 1, e.day + 1));
  const a = utcCalendarDate(dayAfterEnd);
  return {
    start: etMidnight(s.y, s.m, s.day),
    endExclusive: etMidnight(a.y, a.m, a.day),
  };
}

// Whole ET calendar days from `from` up to and including `to`, where both
// are TRUE INSTANTS (a resolved window bound, or `now`). Used by the
// pacing engine; lives here so there is exactly one ET-day implementation
// for the goals code.
//
// Do NOT hand this a raw goal periodStart/periodEnd - those are UTC
// calendar-date markers, and reading 2026-01-01T00:00Z as an ET wall clock
// lands on Dec 31. Run them through `etWindow` first, or use
// `utcMarkerDaysInclusive` if you need to count markers as markers.
export function etDaysInclusive(from: Date, to: Date): number {
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"));
  };
  return Math.round((parts(to) - parts(from)) / 86_400_000) + 1;
}

// Fraction (0..1) of the ET calendar day that `now` sits in which has
// already elapsed, by ET wall clock. Midday ET -> ~0.5. The pacing engine
// uses this to count the current, incomplete day as a partial day instead
// of a whole one, so a short window does not report the full target before
// it has ended. Wall-clock based on purpose: "midday is half the day" is
// exactly the intent, and the DST-length-day edge is a twice-a-year sliver
// that only ever affects the current partial day (whole-day counts stay on
// the DST-safe calendar-date path above).
export function etDayFractionElapsed(now: Date): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  const secs = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
  return Math.min(1, Math.max(0, secs / 86_400));
}

// Whole calendar days between two UTC calendar-date MARKERS, inclusive.
// The marker-space twin of etDaysInclusive: it never re-reads the dates in
// another zone, so a DST boundary inside the span cannot shift the count.
export function utcMarkerDaysInclusive(from: Date, to: Date): number {
  const a = utcCalendarDate(from);
  const b = utcCalendarDate(to);
  const ms = Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day);
  return Math.round(ms / 86_400_000) + 1;
}

// Shift a UTC calendar-date marker by whole days, staying in marker space.
export function shiftUtcMarker(marker: Date, days: number): Date {
  const { y, m, day } = utcCalendarDate(marker);
  return new Date(Date.UTC(y, m - 1, day + days));
}
