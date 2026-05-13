"use client";

import { Bell, Check, Clock, Plus, AlarmClock } from "lucide-react";

import type { CalendarReminder } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

type Props = {
  reminders: CalendarReminder[];
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
};

export function CalendarRemindersPanel({ reminders, onDismiss, onSnooze }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-court-border px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Reminders
          </div>
          <div className="font-serif text-lg font-semibold leading-tight text-court-fg">
            Upcoming
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-court-border-soft bg-court-brand-tint/40 px-5 py-2.5 text-[11.5px] text-court-brand-dark">
        <Bell className="h-3 w-3" /> Ace-native · these never push to Google
      </div>
      <ul>
        {reminders.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-court-fg-muted">
            No reminders set.
          </li>
        ) : (
          reminders.map((r) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              onDismiss={onDismiss}
              onSnooze={onSnooze}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function ReminderRow({
  reminder,
  onDismiss,
  onSnooze,
}: {
  reminder: CalendarReminder;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const r = reminder;
  return (
    <li className="flex items-start gap-3 border-b border-court-border-soft px-5 py-4 last:border-b-0">
      <div
        className={cn(
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          r.urgent
            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            : "bg-court-brand-tint text-court-brand-dark",
        )}
      >
        <Bell className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold leading-snug text-court-fg">
          {r.title}
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[11px]",
            r.urgent ? "text-amber-700 dark:text-amber-200" : "text-court-fg-muted",
          )}
        >
          <Clock className="h-3 w-3" /> {r.when} <span>·</span>
          <span>{r.source}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Snooze 1 hour"
          title="Snooze 1h"
          onClick={() => onSnooze(r.id)}
          className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <AlarmClock className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => onDismiss(r.id)}
          className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <Check className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}
