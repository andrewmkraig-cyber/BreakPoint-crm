// Deterministic date formatters for the BD module. Every visible date
// string in the BD pages is pre-computed on the server using these
// helpers so the same value lands in the SSR HTML and the React Server
// Components payload — eliminating the locale / timezone drift between
// Node's ICU build and the browser's ICU build that was triggering
// React hydration #418/#425 on /bd/client-signal.
//
// Rules:
//   - Explicit locale ("en-US") on every Intl.DateTimeFormat
//   - Explicit timeZone ("America/New_York") since BreakPoint operates
//     on ET and the rest of the dashboard (news feed cron, word/quote
//     of day, etc.) already keys off ET
//   - Relative-time formatting is pure integer math against a `now`
//     timestamp the caller supplies — never reads Date.now() implicitly

const TZ = "America/New_York";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatBdDate(d: Date): string {
  return DATE_FMT.format(d);
}

export function formatBdTime(d: Date): string {
  return TIME_FMT.format(d);
}

export function formatBdDateTime(d: Date): string {
  return DATETIME_FMT.format(d);
}

// "today" / "1 day ago" / "N days ago". Caller passes `nowMs` so all
// rows on a page render against one fixed reference — no per-row
// Date.now() drift.
export function formatDaysAgo(d: Date, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - d.getTime()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Bucket label for the Activity page. Caller passes `nowMs` so every
// row on a page bucket-sorts against the same boundary, regardless of
// when each row's `occurredAt` lands relative to wall-clock time.
export type DayBucket = "Today" | "Yesterday" | "2 days ago" | "Older";

export function bucketForOccurredAt(occurredAt: Date, nowMs: number): DayBucket {
  // Start-of-day in ET. We compute the UTC instant that corresponds to
  // 00:00 ET for the day containing `nowMs`. Crossing that boundary
  // bumps a row from Today → Yesterday consistently between server and
  // client because the math is purely based on the ET date string we
  // derive via the same Intl formatter the rest of the module uses.
  const todayKey = etDateKey(new Date(nowMs));
  const rowKey = etDateKey(occurredAt);
  if (rowKey === todayKey) return "Today";

  // For Yesterday / 2 days ago we walk back exactly 1 / 2 days from the
  // UTC midnight of the ET day boundary. ET observes DST, so subtracting
  // 24h in UTC misses the DST cutover days by an hour twice a year — but
  // the bucket label is recruiter-facing rough triage, so the off-by-one-
  // hour edge is acceptable. The integer day arithmetic dominates.
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterdayKey = etDateKey(new Date(nowMs - oneDayMs));
  if (rowKey === yesterdayKey) return "Yesterday";
  const twoDaysKey = etDateKey(new Date(nowMs - 2 * oneDayMs));
  if (rowKey === twoDaysKey) return "2 days ago";
  return "Older";
}

const YMD_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function etDateKey(d: Date): string {
  // en-CA outputs YYYY-MM-DD which sorts and compares as a plain string.
  return YMD_FMT.format(d);
}
