// Business-day helpers. Reminders and outbound nudges only land Mon-Fri.
//
// These operate on a midnight-UTC Date whose UTC calendar date IS the
// intended day (the convention Ace uses for date-only values like
// installment due dates - see placement-actions.ts, which builds dates via
// `Date.UTC(year, month, day)`). `getUTCDay()` on such a date returns the
// weekday of that calendar date independent of the server's local zone.

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when a midnight-UTC date's calendar day is Saturday or Sunday. */
export function isWeekendUtc(midnightUtc: Date): boolean {
  const dow = midnightUtc.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * If a midnight-UTC date lands on a weekend, pull it back to the prior
 * Friday; otherwise return it unchanged. Saturday -> Friday (-1 day),
 * Sunday -> Friday (-2 days). Reminders fire on weekdays only, so a
 * weekend cue is moved earlier (never later) to keep the recruiter's
 * lead time intact.
 */
export function priorFridayIfWeekendUtc(midnightUtc: Date): Date {
  const dow = midnightUtc.getUTCDay();
  if (dow === 6) return new Date(midnightUtc.getTime() - DAY_MS);
  if (dow === 0) return new Date(midnightUtc.getTime() - 2 * DAY_MS);
  return midnightUtc;
}
