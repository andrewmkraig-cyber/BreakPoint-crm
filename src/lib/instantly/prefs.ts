import { getAppPreferences, updateAppPreferences } from "@/lib/preferences";

// Instantly reply-notification settings. Stored in the same
// app.preferences blob as every other org-wide preference, so there is
// no second settings mechanism to reason about.

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
  pollIntervalMinutes: number;
};

export const DEFAULT_INSTANTLY_PREFS: InstantlyPrefs = {
  pollingEnabled: true,
  replyNotificationsEnabled: true,
  pollIntervalMinutes: 5,
};

function normalizeInterval(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_INSTANTLY_PREFS.pollIntervalMinutes;
  // Snap to an offered option, and never below the cron floor.
  const match = POLL_INTERVAL_OPTIONS.find((o) => o === Math.round(n));
  return match ?? Math.max(MIN_POLL_INTERVAL_MINUTES, Math.round(n));
}

export async function getInstantlyPrefs(): Promise<InstantlyPrefs> {
  const prefs = await getAppPreferences();
  const raw = (prefs.instantly ?? {}) as Partial<InstantlyPrefs>;
  return {
    pollingEnabled:
      typeof raw.pollingEnabled === "boolean"
        ? raw.pollingEnabled
        : DEFAULT_INSTANTLY_PREFS.pollingEnabled,
    replyNotificationsEnabled:
      typeof raw.replyNotificationsEnabled === "boolean"
        ? raw.replyNotificationsEnabled
        : DEFAULT_INSTANTLY_PREFS.replyNotificationsEnabled,
    pollIntervalMinutes: normalizeInterval(raw.pollIntervalMinutes),
  };
}

export async function updateInstantlyPrefs(
  patch: Partial<InstantlyPrefs>,
): Promise<InstantlyPrefs> {
  const current = await getInstantlyPrefs();
  const next: InstantlyPrefs = {
    pollingEnabled:
      typeof patch.pollingEnabled === "boolean"
        ? patch.pollingEnabled
        : current.pollingEnabled,
    replyNotificationsEnabled:
      typeof patch.replyNotificationsEnabled === "boolean"
        ? patch.replyNotificationsEnabled
        : current.replyNotificationsEnabled,
    pollIntervalMinutes:
      patch.pollIntervalMinutes != null
        ? normalizeInterval(patch.pollIntervalMinutes)
        : current.pollIntervalMinutes,
  };
  await updateAppPreferences({ instantly: next });
  return next;
}
