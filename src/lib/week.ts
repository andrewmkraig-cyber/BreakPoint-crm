// Eastern-Time week-window helper for the Dashboard activity counters.
// Every count on the "This week" strip must bind to Monday 00:00:00 ET
// through next Monday 00:00:00 ET (exclusive), NOT a rolling 7-day
// window and NOT the server's UTC day. The server runs UTC on Vercel,
// so without this helper Sunday 8pm ET (= Monday 00:00 UTC) already
// lives in the next week from the server's perspective — the strip
// would flip 4 hours early (5 during EST).

const ZONE = "America/New_York";

// Day-of-week tokens Intl returns for `weekday: "short"` in en-US.
const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

// Pull the offset (minutes east of UTC; ET is negative) from Intl's
// `shortOffset` format for a given instant. Lets us handle both
// EST (-300) and EDT (-240) without hard-coding DST rules.
function easternOffsetMinutes(instant: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const token = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = token.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return -300;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const mins = Number(match[3] ?? "0");
  return sign * (hours * 60 + mins);
}

// Resolve the current week bounds in America/New_York.
//
// Returns `start` (Monday 00:00:00 ET of the current week, as a UTC
// Date instant) and `end` (next Monday 00:00:00 ET, exclusive). Use
// `createdAt: { gte: start, lt: end }` in Prisma queries — that
// correctly captures Monday 00:00 ET through Sunday 23:59:59.999 ET.
export function getEasternWeekBounds(now: Date = new Date()): { start: Date; end: Date } {
  // What ET calendar day is `now` in?
  const ymdFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = ymdFmt.format(now).split("-").map(Number);

  // ET weekday of `now` → days to subtract to reach Monday.
  const weekdayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
  });
  const weekdayToken = weekdayFmt.format(now);
  const daysFromMonday = WEEKDAY_INDEX[weekdayToken] ?? 0;

  // Construct Monday ET 00:00:00 as a UTC instant:
  // 1. Build a naive UTC placeholder at "Monday 00:00 UTC" (the
  //    calendar date we want).
  // 2. The actual UTC instant for "Monday 00:00 ET" is that placeholder
  //    MINUS the ET offset (because ET = UTC + offset; wall-time 00:00
  //    ET is UTC offset_minutes away from 00:00 UTC on the same date).
  // We look up the offset at each bound independently so a DST crossover
  // inside the week doesn't skew the other bound.
  const mondayPlaceholder = new Date(Date.UTC(y, m - 1, d - daysFromMonday, 0, 0, 0));
  const startOffset = easternOffsetMinutes(mondayPlaceholder);
  const start = new Date(mondayPlaceholder.getTime() - startOffset * 60_000);

  const nextMondayPlaceholder = new Date(Date.UTC(y, m - 1, d - daysFromMonday + 7, 0, 0, 0));
  const endOffset = easternOffsetMinutes(nextMondayPlaceholder);
  const end = new Date(nextMondayPlaceholder.getTime() - endOffset * 60_000);

  return { start, end };
}

// Start of "today" in America/New_York, as a UTC Date instant. Use
// `createdAt: { gte: getEasternDayStart() }` to count rows from ET
// midnight today onward — same offset-aware approach as the week bounds
// so it stays correct across EST/EDT and the server's UTC clock.
export function getEasternDayStart(now: Date = new Date()): Date {
  const ymdFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = ymdFmt.format(now).split("-").map(Number);
  const placeholder = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = easternOffsetMinutes(placeholder);
  return new Date(placeholder.getTime() - offset * 60_000);
}

// Format the current ET week as a human-readable label, e.g.
// "Week of May 4-10, 2026" within a single month, or
// "Week of Apr 27 - May 3, 2026" when the week straddles months,
// or "Week of Dec 29, 2025 - Jan 4, 2026" across a year boundary.
// `end` is the exclusive bound returned by getEasternWeekBounds —
// the inclusive Sunday is one day earlier.
export function formatEasternWeekRange(start: Date, end: Date): string {
  const inclusiveEnd = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const partsOf = (instant: Date) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const parts = fmt.formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { month: get("month"), day: get("day"), year: get("year") };
  };
  const a = partsOf(start);
  const b = partsOf(inclusiveEnd);
  if (a.year !== b.year) {
    return `Week of ${a.month} ${a.day}, ${a.year} - ${b.month} ${b.day}, ${b.year}`;
  }
  if (a.month !== b.month) {
    return `Week of ${a.month} ${a.day} - ${b.month} ${b.day}, ${b.year}`;
  }
  return `Week of ${a.month} ${a.day}-${b.day}, ${b.year}`;
}
