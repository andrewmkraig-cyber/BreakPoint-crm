// Date helpers for the calendar. All inputs/outputs are real Date
// objects in local time; callers never deal in decimal-hour day-index
// math anymore. The grid views, navigation, and (next) Google sync
// transform all funnel through these.

const MONTH_NAMES_LONG = [
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
] as const;

const WEEKDAY_LABELS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
// Mon-first 7-day label list for the full-week view. Sat/Sun were
// added when the grid expanded past the work week — see week-view.tsx.
const WEEKDAY_LABELS_FULL = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

const WEEKDAY_LABELS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type WeekDay = {
  // Stable react key.
  key: string;
  // "Mon", "Tue", ...
  label: string;
  // Day-of-month number for the column header.
  date: number;
  // Real Date at 00:00 local for this column. Used to bucket events.
  fullDate: Date;
};

// Returns Monday 00:00 local for the week containing `d`. Sunday is
// treated as the END of the prior work week, so Sunday May 17 maps to
// Monday May 11.
export function getMondayOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  return out;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function getStartOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Decimal-hour representation of a Date's local time-of-day. 9:30 AM
// returns 9.5. Used by the grid to position events against the hourly
// row scale shared with hourToY in utils.ts.
export function decimalHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// The 5-column Mon-Fri header for the week containing `monday`. Caller
// is expected to pass an already-snapped Monday from getMondayOfWeek.
export function getWorkWeekDays(monday: Date): WeekDay[] {
  return WEEKDAY_LABELS_SHORT.map((label, i) => {
    const d = addDays(monday, i);
    return {
      key: label.toLowerCase(),
      label,
      date: d.getDate(),
      fullDate: d,
    };
  });
}

// The 7-column Mon-Sun header for the week containing `monday` — used
// by the week view since it expanded to include Sat/Sun. Kept separate
// from getWorkWeekDays so any work-week-only consumer (e.g. a future
// analytics view) doesn't accidentally pick up the weekend.
export function getFullWeekDays(monday: Date): WeekDay[] {
  return WEEKDAY_LABELS_FULL.map((label, i) => {
    const d = addDays(monday, i);
    return {
      key: label.toLowerCase(),
      label,
      date: d.getDate(),
      fullDate: d,
    };
  });
}

export function getMonthName(d: Date): string {
  return MONTH_NAMES_LONG[d.getMonth()];
}

export function getWeekdayLong(d: Date): string {
  return WEEKDAY_LABELS_LONG[d.getDay()];
}

// Inclusive count of days in `d`'s month.
export function getDaysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Month-name + day range for the week header, e.g. "May 11 – 15" or
// "May 30 – Jun 3" when the work week straddles a month boundary.
export function formatWeekRange(monday: Date): string {
  const friday = addDays(monday, 4);
  if (monday.getMonth() === friday.getMonth()) {
    return `${getMonthName(monday)} ${monday.getDate()} – ${friday.getDate()}`;
  }
  return `${getMonthName(monday)} ${monday.getDate()} – ${getMonthName(friday)} ${friday.getDate()}`;
}

// Mon-Sun variant of formatWeekRange. The week view shows all 7 days
// now, so the header should announce the same span the grid covers
// ("May 25 – 31") instead of stopping at Friday.
export function formatFullWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${getMonthName(monday)} ${monday.getDate()} – ${sunday.getDate()}`;
  }
  return `${getMonthName(monday)} ${monday.getDate()} – ${getMonthName(sunday)} ${sunday.getDate()}`;
}
