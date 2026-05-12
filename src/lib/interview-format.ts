// Deterministic date/time formatters for interview surfaces. Mirrors the
// BD module's date-format.ts pattern: explicit locale ("en-US") and
// timezone ("America/New_York") on every Intl.DateTimeFormat so the same
// string lands in the SSR HTML and the React hydration payload. Without
// this, Node's ICU and the browser's ICU drift on locale/timezone defaults
// and trip React hydration #418/#423/#425 in the interview scheduler and
// edit dialogs.

const TZ = "America/New_York";

const NEXT_INTERVIEW_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const WHEN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const UPCOMING_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatInterviewWhen(d: Date): string {
  return WHEN_FMT.format(d);
}

export function formatInterviewDate(d: Date): string {
  return DATE_FMT.format(d);
}

export function formatInterviewTime(d: Date): string {
  return TIME_FMT.format(d);
}

export function formatInterviewNextLine(iso: string, type: "phone_screen" | "video" | "in_person"): string {
  const d = new Date(iso);
  const date = NEXT_INTERVIEW_DATE_FMT.format(d);
  const time = TIME_FMT.format(d);
  const label = type === "phone_screen" ? "Phone" : type === "video" ? "Video" : "In-Person";
  return `· ${date} · ${time} · ${label}`;
}

export function formatUpcomingInterviewWhen(d: Date): string {
  return UPCOMING_FMT.format(d);
}
