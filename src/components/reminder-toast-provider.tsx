"use client";

import { Bell, Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { dismissReminder as dismissReminderAction } from "@/app/calendar/reminder-actions";
import { ActionChip } from "@/components/_toast-chrome";
import { getStoredToastTheme, toastBoxShadow } from "@/lib/toast-theme";

type DueReminder = {
  id: string;
  title: string;
  reminderAt: string;
};

// Global reminder watcher. Mounted once in the root layout so the
// 60-second tick keeps running as the user navigates between pages —
// the previous design lived inside /calendar and went silent the
// moment Andrew clicked away. Renders the same toast chrome as the
// mail/text notifications (border, shadow, ActionChip) so reminders
// don't feel like a different surface; the only visual difference is
// the amber tint on the left strip and icon container.
export function ReminderToastProvider() {
  const firedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const fire = (r: DueReminder) => {
      toast.custom(
        (id) => (
          <ReminderToast
            reminder={r}
            toastId={id}
            onPersist={() => {
              firedIds.current.delete(r.id);
            }}
          />
        ),
        { duration: Infinity },
      );
    };

    const pull = async () => {
      try {
        const res = await fetch("/api/reminders/due", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { reminders: DueReminder[] };
        for (const r of body.reminders) {
          if (firedIds.current.has(r.id)) continue;
          firedIds.current.add(r.id);
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
              tag: `reminder-${r.id}`,
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
  const theme = getStoredToastTheme();

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
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: "360px",
        maxWidth: "420px",
        padding: "12px 14px",
        borderRadius: "14px",
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: theme.fg,
        boxShadow: toastBoxShadow(),
        overflow: "hidden",
      }}
    >
      {theme.leftStrip && (
        <span
          aria-hidden="true"
          className="bg-amber-500 dark:bg-amber-400"
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: "3px",
          }}
        />
      )}
      <div
        className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Bell size={17} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: theme.fg,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {reminder.title}
          </span>
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: theme.fgMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: 2,
          }}
        >
          Reminder · {formattedTime}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          marginLeft: 12,
        }}
      >
        <ActionChip
          theme={theme}
          onClick={handleDismiss}
          label="Dismiss"
          icon={<Check size={12} />}
        />
      </div>
    </div>
  );
}
