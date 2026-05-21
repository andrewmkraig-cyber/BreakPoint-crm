// Timezone helpers for the "Send Later" scheduler. Pure functions, no
// React or server-only deps, so both the client picker and the server
// schedule routes can share them.

export type TimezoneOption = { value: string; label: string };

// Curated list for a US recruiting firm. ET is the default everywhere
// (BreakPoint runs on Eastern). UTC is intentionally NOT offered as a
// user-facing option; it is an internal storage format only. Legacy rows
// that stored "UTC" still render via formatScheduledTime's fallback.
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
];

export const DEFAULT_TIMEZONE = "America/New_York";

// How far off `timeZone` runs from UTC at a given absolute instant, in
// milliseconds. Computed by asking Intl what wall clock the zone shows
// for that instant and diffing against UTC. Handles DST automatically.
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Some engines emit hour "24" at midnight; normalize to 0.
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour % 24,
    map.minute,
    map.second,
  );
  return asUTC - utcMs;
}

// Convert a wall-clock time in `timeZone` to the absolute UTC instant.
// Treat the components as if they were UTC, measure the zone offset at
// that guess, then correct. A second pass settles the rare case where
// the correction crosses a DST boundary.
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(guess, timeZone);
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(utc, timeZone);
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc);
}

// Parse the picker's <input type="date"> + <input type="time"> values
// (YYYY-MM-DD and HH:MM) interpreted in `timeZone`, returning the ISO
// UTC string we persist on ScheduledEmail.scheduledSendAt.
export function scheduleInputToUtcISO(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dm || !tm) return null;
  const d = zonedWallTimeToUtc(
    Number(dm[1]),
    Number(dm[2]),
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    timeZone,
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Human-readable rendering of an absolute instant in the chosen zone,
// e.g. "May 21, 2026, 9:00 AM ET". Used in confirmation toasts.
export function formatScheduledTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const base = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  const label =
    TIMEZONE_OPTIONS.find((t) => t.value === timeZone)?.label ?? timeZone;
  // Pull the short code out of the label parens when present.
  const short = /\(([^)]+)\)/.exec(label)?.[1] ?? label;
  return `${base} ${short}`;
}

// The picker's initial values: today's date and the next top-of-hour an
// hour out, in the given zone. Returns the strings the date/time inputs
// expect (interpreted in `timeZone`).
export function defaultScheduleInputs(
  timeZone: string = DEFAULT_TIMEZONE,
): { date: string; time: string } {
  const target = new Date(Date.now() + 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(target);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${hour}:00`,
  };
}
