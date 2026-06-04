const HIDDEN_GOOGLE_MIRRORS = [
  { day: 18, title: /dog medicine/i },
  { day: 19, title: /pay sidney/i },
] as const;

function dayOfMonthInEastern(d: Date): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return Number.isFinite(day) ? day : null;
}

export function isSuppressedGoogleMirror(title: string | null | undefined, start: Date): boolean {
  const day = dayOfMonthInEastern(start);
  if (day == null || !title) return false;
  return HIDDEN_GOOGLE_MIRRORS.some((rule) => rule.day === day && rule.title.test(title));
}
