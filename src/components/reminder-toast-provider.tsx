"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { dismissReminder as dismissReminderAction } from "@/app/calendar/reminder-actions";

type DueReminder = {
  id: string;
  title: string;
  reminderAt: string;
};

// Global reminder watcher. Mounted once in the root layout so the
// 60-second tick keeps running as the user navigates between pages —
// the previous design lived inside /calendar and went silent the
// moment Andrew clicked away. Fires sonner toasts (the Toaster is
// already mounted in <Providers>). Each id fires at most once per
// page load (tracked in a ref Set); a successful dismiss removes the
// id from the Set, while a failed dismiss leaves it in place so a
// transient network blip doesn't spam re-fires on the next 60s tick.
export function ReminderToastProvider() {
  const firedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const formatTime = (iso: string): string =>
      new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });

    const fire = (r: DueReminder) => {
      toast(r.title, {
        description: `Reminder · ${formatTime(r.reminderAt)}`,
        duration: Infinity,
        action: {
          label: "Dismiss",
          onClick: () => {
            void dismissReminderAction(r.id)
              .then(() => {
                firedIds.current.delete(r.id);
              })
              .catch((err) => {
                console.error("Reminder dismiss failed", err);
              });
          },
        },
      });
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
