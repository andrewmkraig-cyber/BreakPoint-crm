import { getAppPreferences, updateAppPreferences } from "@/lib/preferences";

// Instantly reply-notification settings. Stored in the same
// app.preferences blob as every other org-wide preference, so there is
// no second settings mechanism to reason about.

import {
  DEFAULT_INSTANTLY_PREFS,
  MIN_POLL_INTERVAL_MINUTES,
  POLL_INTERVAL_OPTIONS,
  normalizeInterval,
  type InstantlyPrefs,
} from "@/lib/instantly/prefs-shared";

// Re-exported so existing `from "@/lib/instantly/prefs"` imports keep
// working. CLIENT components must import from prefs-shared directly -
// this module reaches prisma.
export {
  DEFAULT_INSTANTLY_PREFS,
  MIN_POLL_INTERVAL_MINUTES,
  POLL_INTERVAL_OPTIONS,
};
export type { InstantlyPrefs };

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
    clearReadFromInstantly:
      typeof raw.clearReadFromInstantly === "boolean"
        ? raw.clearReadFromInstantly
        : DEFAULT_INSTANTLY_PREFS.clearReadFromInstantly,
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
    clearReadFromInstantly:
      typeof patch.clearReadFromInstantly === "boolean"
        ? patch.clearReadFromInstantly
        : current.clearReadFromInstantly,
    pollIntervalMinutes:
      patch.pollIntervalMinutes != null
        ? normalizeInterval(patch.pollIntervalMinutes)
        : current.pollIntervalMinutes,
  };
  await updateAppPreferences({ instantly: next });
  return next;
}
