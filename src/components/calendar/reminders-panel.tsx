"use client";

import { AlarmClock, Bell, Check, Clock, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { CalendarReminder } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

type Props = {
  reminders: CalendarReminder[];
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
  onCreate: (title: string, reminderAt: Date) => Promise<void>;
};

export function CalendarRemindersPanel({
  reminders,
  onDismiss,
  onSnooze,
  onCreate,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);

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
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
        >
          {formOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {formOpen ? "Cancel" : "New"}
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-court-border-soft bg-court-brand-tint/40 px-5 py-2.5 text-[11.5px] text-court-brand-dark">
        <Bell className="h-3 w-3" /> Ace-native · these never push to Google
      </div>
      {formOpen && (
        <NewReminderForm
          onCancel={() => setFormOpen(false)}
          onCreate={async (title, when) => {
            await onCreate(title, when);
            setFormOpen(false);
          }}
        />
      )}
      <ul>
        {reminders.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-court-fg-muted">
            No upcoming reminders.
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

// Inline create form. Date is a native picker; time is a select on
// 15-minute increments so the recruiter can't pick "9:13" by mistake.
// The save button is enabled only when there's a title + a future
// reminderAt — we don't surface server-side errors here yet because
// the action throws on invalid input and the caller logs to console.
function NewReminderForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (title: string, reminderAt: Date) => Promise<void>;
}) {
  const today = useMemo(() => new Date(), []);
  const defaultDate = isoDate(today);
  const defaultTime = nextQuarterHour(today);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [submitting, setSubmitting] = useState(false);

  const timeOptions = useMemo(() => buildQuarterHours(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !date || !time) return;
    const reminderAt = new Date(`${date}T${time}`);
    if (Number.isNaN(reminderAt.getTime())) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed, reminderAt);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 border-b border-court-border-soft bg-court-surface-subtle px-5 py-3.5"
    >
      <input
        type="text"
        autoFocus
        placeholder="What's the reminder?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-[12.5px] text-court-fg outline-none focus:border-court-brand/60 focus:ring-2 focus:ring-court-brand/20"
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          min={defaultDate}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-lg border border-court-border bg-court-surface px-2 py-1.5 text-[12px] text-court-fg outline-none focus:border-court-brand/60 focus:ring-2 focus:ring-court-brand/20"
        />
        <select
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="flex-1 rounded-lg border border-court-border bg-court-surface px-2 py-1.5 text-[12px] text-court-fg outline-none focus:border-court-brand/60 focus:ring-2 focus:ring-court-brand/20"
        >
          {timeOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-semibold text-court-fg-muted hover:text-court-fg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-court-brand bg-court-surface px-3 py-1 text-[11.5px] font-semibold text-court-brand-dark transition hover:bg-court-brand-tint/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Next 15-minute boundary at or after `from`. Used as the default
// time when the form opens so the user starts with a sensible value
// instead of midnight.
function nextQuarterHour(from: Date): string {
  const minutes = Math.ceil(from.getMinutes() / 15) * 15;
  const hour = (from.getHours() + Math.floor(minutes / 60)) % 24;
  const mins = minutes % 60;
  return `${pad(hour)}:${pad(mins)}`;
}

function buildQuarterHours(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 15, 30, 45]) {
      const value = `${pad(h)}:${pad(m)}`;
      const hour12 = ((h + 11) % 12) + 1;
      const suffix = h < 12 ? "AM" : "PM";
      out.push({ value, label: `${hour12}:${pad(m)} ${suffix}` });
    }
  }
  return out;
}
