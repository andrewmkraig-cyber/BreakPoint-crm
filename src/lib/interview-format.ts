// Deterministic date/time formatters for interview surfaces. Mirrors the
// BD module's date-format.ts pattern: explicit locale ("en-US") on every
// Intl.DateTimeFormat so the same string lands in the SSR HTML and the
// React hydration payload. The timezone is now configurable per call so
// candidate-facing invite copy ("3:00 PM PT") matches the zone the
// recruiter actually picked on the scheduler — historically every
// formatter hardcoded ET, which silently truncated zone info from any
// PT/CT/MT-scheduled interview's email body.

import { abbrForTimeZone, DEFAULT_INTERVIEW_TIMEZONE } from "@/lib/timezones";

// Pre-built ET formatters for the "we never asked the recruiter for a
// zone" surfaces (dashboard upcoming-interviews row, pipeline next-line,
// etc.). Anywhere the zone matters — Schedule Interview, Edit, the
// invite composers — we hand-build a formatter against the explicit
// zone via withZone() below.
const NEXT_INTERVIEW_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_INTERVIEW_TIMEZONE,
  month: "short",
  day: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_INTERVIEW_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
});

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_INTERVIEW_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const WHEN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_INTERVIEW_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const UPCOMING_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_INTERVIEW_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// When a caller passes an explicit tz, build one-off formatters keyed
// to that zone. Keep the {locale, options} the same as the cached ET
// formatters so the output shape stays predictable — only the timezone
// substitution changes.
function withZone(
  base: { tz?: string },
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    ...opts,
    timeZone: base.tz || DEFAULT_INTERVIEW_TIMEZONE,
  });
}

// All exported formatters accept an optional `tz` (IANA name). When
// passed, the time is rendered in that zone AND the appropriate
// abbreviation ("ET" / "CT" / "MT" / "PT") is appended so the reader
// always sees "WHICH 3:00 PM" without us having to bake it into every
// template body manually.
export function formatInterviewWhen(d: Date, tz?: string): string {
  if (!tz) return WHEN_FMT.format(d);
  return `${withZone({ tz }, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)} ${abbrForTimeZone(tz)}`;
}

export function formatInterviewDate(d: Date, tz?: string): string {
  if (!tz) return DATE_FMT.format(d);
  return withZone({ tz }, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function formatInterviewTime(d: Date, tz?: string): string {
  if (!tz) return TIME_FMT.format(d);
  return `${withZone({ tz }, { hour: "numeric", minute: "2-digit" }).format(d)} ${abbrForTimeZone(tz)}`;
}

export function formatInterviewNextLine(
  iso: string,
  type: "phone_screen" | "video" | "in_person",
  tz?: string,
): string {
  const d = new Date(iso);
  const dateFmt = tz
    ? withZone({ tz }, { month: "short", day: "numeric" })
    : NEXT_INTERVIEW_DATE_FMT;
  const timeFmt = tz
    ? withZone({ tz }, { hour: "numeric", minute: "2-digit" })
    : TIME_FMT;
  const date = dateFmt.format(d);
  const time = timeFmt.format(d);
  const tzTag = tz ? ` ${abbrForTimeZone(tz)}` : "";
  const label = type === "phone_screen" ? "Phone" : type === "video" ? "Video" : "In-Person";
  return `· ${date} · ${time}${tzTag} · ${label}`;
}

export function formatUpcomingInterviewWhen(d: Date, tz?: string): string {
  if (!tz) return UPCOMING_FMT.format(d);
  return `${withZone({ tz }, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)} ${abbrForTimeZone(tz)}`;
}
