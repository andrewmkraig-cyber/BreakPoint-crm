// Interview-scheduler timezones + wall-clock conversion helpers. Lives
// in src/lib/ so the schedule/reschedule/edit dialogs (and any future
// surface) can share one list + one conversion path — the previous
// inline IANA dropdowns drifted out of sync (6 options here, 0 there)
// and used a buggy `new Date(localString)` parse that interpreted the
// wall-clock in the BROWSER's zone instead of the recruiter-picked
// zone. That caused the "EST event lands 4 hours earlier" bug Andrew
// reported.
//
// Restricting to 4 zones (ET/CT/MT/PT) is intentional — Ace ships to a
// US recruiting team. Alaska / Hawaii / international zones got removed
// because they invited misclicks more than they served real bookings.

export type InterviewTimeZone = {
  // IANA zone identifier — what Google Calendar wants on event.start.timeZone
  // and what Intl.DateTimeFormat consumes for the conversion + display.
  iana: string;
  // Short label shown in the dropdown ("ET", "CT", …). Stable across DST
  // so the picker doesn't flip ET ↔ EDT between November and March.
  abbr: "ET" | "CT" | "MT" | "PT";
  // Full label rendered as the picker option text.
  label: string;
};

export const INTERVIEW_TIMEZONES: ReadonlyArray<InterviewTimeZone> = [
  { iana: "America/New_York", abbr: "ET", label: "Eastern (ET)" },
  { iana: "America/Chicago", abbr: "CT", label: "Central (CT)" },
  { iana: "America/Denver", abbr: "MT", label: "Mountain (MT)" },
  { iana: "America/Los_Angeles", abbr: "PT", label: "Pacific (PT)" },
];

export const DEFAULT_INTERVIEW_TIMEZONE = "America/New_York";

// Lookup helpers. Defensive against legacy values (e.g. America/Anchorage
// rows saved before the 4-zone restriction) — those fall back to ET as
// the safe default rather than crashing on a missing label.
export function abbrForTimeZone(iana: string | null | undefined): string {
  if (!iana) return "ET";
  const hit = INTERVIEW_TIMEZONES.find((z) => z.iana === iana);
  return hit?.abbr ?? "ET";
}

export function isSupportedInterviewTimeZone(iana: string): boolean {
  return INTERVIEW_TIMEZONES.some((z) => z.iana === iana);
}

// Converts a `YYYY-MM-DDTHH:mm` wall-clock string interpreted in `tz`
// to the corresponding UTC Date. The browser's local timezone never
// enters the calculation — the same string + zone produces the same
// instant regardless of where the recruiter is sitting.
//
// Two-pass to handle the DST transition edge: the first offset guess
// (looked up at the as-if-UTC instant) can be wrong by one hour at the
// boundary; recomputing the offset at the shifted instant snaps to the
// correct side. Inside the spring-forward gap (e.g. 2:30 AM doesn't
// exist) the algorithm converges to the post-jump side, which is the
// least-surprising choice for interview scheduling — recruiters don't
// book 2:30 AM anyway.
export function wallClockInZoneToUTC(datetimeLocal: string, tz: string): Date {
  if (!datetimeLocal) return new Date(NaN);
  // Add the missing seconds so the Z-suffixed parse is well-formed
  // ("2026-05-27T13:00:00Z"). Treat the wall-clock as if it were UTC to
  // get a reference instant for the offset lookup.
  const seeded = datetimeLocal.length === 16 ? `${datetimeLocal}:00` : datetimeLocal;
  const asIfUTC = new Date(`${seeded}Z`);
  if (Number.isNaN(asIfUTC.getTime())) return asIfUTC;
  let offset = tzOffsetMs(asIfUTC, tz);
  const realFirstPass = new Date(asIfUTC.getTime() - offset);
  offset = tzOffsetMs(realFirstPass, tz);
  return new Date(asIfUTC.getTime() - offset);
}

// Returns the offset (in ms) of `tz` at instant `d`: positive east of
// UTC. Built off Intl.DateTimeFormat's formatToParts because Node and
// the browser both ship a working ICU implementation — no date-library
// dep needed. Format the same instant as a wall-clock string in `tz`,
// reparse as UTC, diff = offset.
function tzOffsetMs(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // Intl returns "24" instead of "00" on midnight in some ICU builds —
  // normalize to 0 so Date.UTC doesn't roll into the next day.
  const hour = Number(parts.hour) % 24;
  const asMillis = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asMillis - d.getTime();
}
