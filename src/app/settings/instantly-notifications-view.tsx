"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ToggleRow, SegmentedSetting } from "@/app/settings/preferences-view";
import { setInstantlyPref } from "@/app/settings/instantly-actions";
import {
  POLL_INTERVAL_OPTIONS,
  type InstantlyPrefs,
} from "@/lib/instantly/prefs-shared";

// Instantly reply-notification settings. Renders directly beneath the
// Instantly connector row.
//
// Reuses ToggleRow (the same switch the notification preferences use) so
// the shape, spacing, and optimistic save-then-revert behavior match the
// rest of Settings exactly.

export function InstantlyNotificationsView({ initial }: { initial: InstantlyPrefs }) {
  const [prefs, setPrefs] = useState<InstantlyPrefs>(initial);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function save(patch: Partial<InstantlyPrefs>, key: string) {
    const previous = prefs;
    setPrefs((p) => ({ ...p, ...patch }));
    setPendingKey(key);
    start(async () => {
      const result = await setInstantlyPref(patch);
      setPendingKey(null);
      if (!result.ok) {
        setPrefs(previous);
        toast.error("Couldn't save setting", { description: result.error });
      }
    });
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <ToggleRow
        label="Poll Instantly for new replies"
        description="Checks for inbound replies on a schedule so you don't have to keep Instantly open. Off stops all polling and notifications."
        checked={prefs.pollingEnabled}
        onChange={(next) => save({ pollingEnabled: next }, "polling")}
        disabled={isPending && pendingKey === "polling"}
      />

      <ToggleRow
        label="Notify me about genuine replies"
        description="Pops a toast when a real reply lands. Out-of-office and other auto-replies never notify, whatever this is set to."
        checked={prefs.replyNotificationsEnabled}
        onChange={(next) => save({ replyNotificationsEnabled: next }, "notify")}
        disabled={isPending && pendingKey === "notify"}
      />

      <ToggleRow
        label="Clear when I read it in Instantly"
        description="Reads the thread in Instantly and the Ace badge clears itself, so you don't have to dismiss the same reply twice. Ace already works the other way round: reading it here marks it read there."
        checked={prefs.clearReadFromInstantly}
        onChange={(next) => save({ clearReadFromInstantly: next }, "clearRead")}
        disabled={isPending && pendingKey === "clearRead"}
      />

      <div className="border-t border-court-border pt-3">
        {/* Same segmented control the notification duration / stack
            settings use, reused rather than reimplemented. */}
        <SegmentedSetting
          label="Check frequency"
          description="How often Ace looks for new replies. 5 minutes is the floor - the schedule is fixed at the hosting level, so this can slow polling down but never speed it up."
          value={String(prefs.pollIntervalMinutes)}
          options={POLL_INTERVAL_OPTIONS.map((m) => ({
            id: String(m),
            label: `${m} min`,
          }))}
          onPick={(id) => save({ pollIntervalMinutes: Number(id) }, "interval")}
        />
      </div>
    </div>
  );
}
