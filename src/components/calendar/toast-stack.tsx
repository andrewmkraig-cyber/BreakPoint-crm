"use client";

import { AlarmClock, Bell, ChevronUp, X } from "lucide-react";

import type { CalendarReminder } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

type Props = {
  reminders: CalendarReminder[];
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
};

// Persistent reminder toasts. They sit bottom-right, do not
// auto-dismiss, and can be minimized to a single pill. Ace-native
// only. Nothing on this stack reflects Google Calendar state.

export function CalendarToastStack({
  reminders,
  collapsed,
  onCollapse,
  onDismiss,
  onSnooze,
}: Props) {
  if (reminders.length === 0) return null;
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onCollapse(false)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-court-border bg-court-surface px-3.5 py-2 text-[12.5px] font-semibold text-court-fg shadow-md hover:border-court-brand/40"
      >
        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-court-brand text-white">
          <Bell className="h-3 w-3" />
        </span>
        <span>
          {reminders.length} {reminders.length === 1 ? "reminder" : "reminders"}
        </span>
        <ChevronUp className="h-3 w-3 text-court-fg-muted" />
      </button>
    );
  }
  return (
    <div className="fixed bottom-5 right-5 z-30 flex w-[360px] max-w-[calc(100vw-44px)] flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
          <Bell className="h-3 w-3" /> Reminders · {reminders.length}
        </div>
        <button
          type="button"
          onClick={() => onCollapse(true)}
          className="text-[10.5px] font-semibold text-court-fg-muted hover:text-court-fg"
        >
          Minimize
        </button>
      </div>
      {reminders.map((r) => (
        <div
          key={r.id}
          className="flex items-start gap-3 rounded-2xl border border-court-border bg-court-surface px-3.5 py-3.5 shadow-lg"
        >
          <span
            className={cn(
              "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl",
              r.urgent
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                : "bg-court-brand-tint text-court-brand-dark",
            )}
          >
            <Bell className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div
                className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.16em]",
                  r.urgent ? "text-amber-700 dark:text-amber-200" : "text-court-brand-dark",
                )}
              >
                {r.urgent ? "Due soon" : "Ace reminder"}
              </div>
              <div className="text-[10.5px] font-semibold tabular-nums text-court-fg-muted">
                {r.when}
              </div>
            </div>
            <div className="mt-0.5 text-[13px] font-semibold leading-snug text-court-fg">
              {r.title}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onSnooze(r.id)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-court-fg-muted hover:text-court-fg"
              >
                <AlarmClock className="h-3 w-3" /> Snooze 1h
              </button>
              <span className="text-court-fg-dim">·</span>
              <button
                type="button"
                className="text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
              >
                Open
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(r.id)}
            className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-full text-court-fg-muted hover:bg-court-surface-subtle"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
