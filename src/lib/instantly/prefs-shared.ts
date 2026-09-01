// Pure Instantly preference constants, types and defaults.
//
// WHY THIS IS SPLIT OUT. src/app/settings/instantly-notifications-view.tsx is
// a CLIENT component and imports POLL_INTERVAL_OPTIONS as a value. That
// constant used to live in prefs.ts, which imports @/lib/preferences ->
// @/lib/prisma - and @/lib/prisma calls `base.$extends(...)` at module
// scope, which is a property read on the browser build's throwing Proxy. So
// the import shipped PrismaClient to the browser and threw
// "PrismaClient is unable to run in this browser environment" the moment
// the module was evaluated.
//
// Nothing here may import prisma or anything that reaches it. prefs.ts
// re-exports every symbol, so existing server-side imports are unchanged.

// The Vercel cron fires every 5 minutes and the poller no-ops until the
// chosen interval has elapsed. That means the interval can only make
// polling SLOWER than 5 minutes - a static cron schedule cannot be
// sped up from the database. 5 is therefore the floor, not a default
// that can be lowered.
export const POLL_INTERVAL_OPTIONS = [5, 10, 15, 30] as const;
export const MIN_POLL_INTERVAL_MINUTES = 5;

export type InstantlyPrefs = {
  /** Master switch for the poller. Off = no polling, no notifications. */
  pollingEnabled: boolean;
  /** Fire an in-app toast when a genuine reply lands. */
  replyNotificationsEnabled: boolean;
  /**
   * Clear an Ace notification when the same thread is read in Instantly.
   * The return leg of the read mirror - Ace already pushes its own reads
   * outward, this brings Instantly's reads back in so the badge follows
   * whichever inbox you actually cleared from.
   */
  clearReadFromInstantly: boolean;
  pollIntervalMinutes: number;
};

export const DEFAULT_INSTANTLY_PREFS: InstantlyPrefs = {
  pollingEnabled: true,
  replyNotificationsEnabled: true,
  clearReadFromInstantly: true,
  pollIntervalMinutes: 5,
};

// Clamps a stored/patched interval onto the allowed options. Pure, and
// shared so the read path and the write path cannot disagree.
export function normalizeInterval(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_INSTANTLY_PREFS.pollIntervalMinutes;
  // Snap to an offered option, and never below the cron floor.
  const match = POLL_INTERVAL_OPTIONS.find((o) => o === Math.round(n));
  return match ?? Math.max(MIN_POLL_INTERVAL_MINUTES, Math.round(n));
}
