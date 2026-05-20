"use client";

import { Bell, Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { dismissReminder as dismissReminderAction } from "@/app/calendar/reminder-actions";
import { getStoredToastDurationMs, registerToast } from "@/lib/toast-prefs";

type DueReminder = {
  // Stable per-lead key (e.g. "<id>:15") so a reminder with multiple
  // notification leads fires once per lead instead of being deduped to
  // a single toast by id.
  key: string;
  id: string;
  title: string;
  reminderAt: string;
};

// Global reminder watcher. Mounted once in the root layout so the
// 60-second tick keeps running as the user navigates between pages -
// the previous design lived inside /calendar and went silent the
// moment Andrew clicked away. Renders the same card structure as the
// mail/text notification toasts (rounded card, white icon square,
// bottom-right action row) in an amber palette so reminders read as the
// same surface in a different color.
export function ReminderToastProvider() {
  const firedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const fire = (r: DueReminder) => {
      toast.custom(
        (id) => (
          <ReminderToast
            reminder={r}
            toastId={id}
            onPersist={() => {
              firedKeys.current.delete(r.key);
            }}
          />
        ),
        // Respects the user's Notification duration setting like the SMS
        // and email toasts (default 5s; "Until dismissed" = Infinity).
        { duration: getStoredToastDurationMs() },
      );
    };

    const pull = async () => {
      try {
        const res = await fetch("/api/reminders/due", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { reminders: DueReminder[] };
        for (const r of body.reminders) {
          if (firedKeys.current.has(r.key)) continue;
          firedKeys.current.add(r.key);
          fire(r);
          // Mirror the toast as a push to every subscribed device on
          // this account. Relayed through /api/push/fire because
          // sendPushToUser is server-only. Tag dedupes per reminder
          // so repeated polls of the same /api/reminders/due payload
          // don't restack the same notification.
          void fetch("/api/push/fire", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: r.title,
              body: `Reminder · ${new Date(r.reminderAt).toLocaleTimeString(
                undefined,
                { hour: "numeric", minute: "2-digit" },
              )}`,
              url: "/calendar",
              tag: `reminder-${r.key}`,
            }),
          }).catch(() => {});
        }
      } catch (err) {
        console.error("Reminder poll failed", err);
      }
    };

    void pull();
    const id = window.setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}

function ReminderToast({
  reminder,
  toastId,
  onPersist,
}: {
  reminder: DueReminder;
  toastId: string | number;
  onPersist: () => void;
}) {
  // Count this toast toward the active-stack total so the Dismiss All
  // control can appear when two or more are visible.
  useEffect(() => registerToast(), []);

  function handleDismiss() {
    void dismissReminderAction(reminder.id)
      .then(() => {
        onPersist();
      })
      .catch((err) => {
        console.error("Reminder dismiss failed", err);
      });
    toast.dismiss(toastId);
  }

  const formattedTime = new Date(reminder.reminderAt).toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" },
  );

  return (
    <div className="relative flex w-[314px] max-w-[94vw] items-center gap-2.5 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 shadow-[0_8px_22px_rgba(0,0,0,0.08)] dark:border-amber-500/50 dark:bg-amber-950/40">
      {/* Left icon: white rounded square matching the SMS/email toasts,
          with an amber Bell glyph. */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-court-surface shadow-sm">
        <Bell className="h-4 w-4 text-amber-500" />
      </div>

      {/* Center column: title + "Reminder · time", then a bottom-right
          action row carrying the existing Dismiss button unchanged. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-[12px] font-semibold leading-tight tracking-[-0.02em] text-court-fg">
          {reminder.title}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-medium text-court-fg-muted">
          Reminder · {formattedTime}
        </div>

        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
          >
            <Check className="h-2.5 w-2.5" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
