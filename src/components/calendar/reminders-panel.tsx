"use client";

import { Bell, Clock, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { TimeSelect } from "@/components/calendar/time-select";
import type { CalendarReminder } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

type Props = {
  reminders: CalendarReminder[];
  // Reminder id whose inline editor is open (driven by the panel's own
  // Edit button and by clicking a reminder block on the grid).
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onCreate: (title: string, reminderAt: Date, notifyLeadsMin: number[]) => Promise<void>;
  onUpdate: (
    id: string,
    title: string,
    reminderAt: Date,
    notifyLeadsMin: number[],
  ) => Promise<void>;
  onDelete: (id: string) => void;
};

// Notification leads the editor offers, soonest-window first. 0 is not
// offered in the panel (reserved for event/interview-linked rows).
const LEAD_PRESETS: Array<{ value: number; label: string }> = [
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hr before" },
  { value: 120, label: "2 hr before" },
  { value: 1440, label: "1 day before" },
];

function leadLabel(value: number): string {
  return LEAD_PRESETS.find((p) => p.value === value)?.label ?? `${value} min before`;
}

function leadsSummary(leads: number[]): string {
  if (leads.length === 0) return "No notifications";
  return leads
    .slice()
    .sort((a, b) => b - a)
    .map((l) => leadLabel(l).replace(" before", ""))
    .join(" · ") + " before";
}

export function CalendarRemindersPanel({
  reminders,
  editingId,
  onEdit,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);

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
          onClick={() => {
            onEdit(null);
            setCreating((v) => !v);
          }}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
        >
          {creating ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {creating ? "Cancel" : "New"}
        </button>
      </div>
      {creating && (
        <ReminderForm
          submitLabel="Save"
          onCancel={() => setCreating(false)}
          onSubmit={async (title, when, leads) => {
            await onCreate(title, when, leads);
            setCreating(false);
          }}
        />
      )}
      <ul>
        {reminders.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-court-fg-muted">
            No upcoming reminders.
          </li>
        ) : (
          reminders.map((r) =>
            editingId === r.id ? (
              <li
                key={r.id}
                className="border-b border-court-border-soft last:border-b-0"
              >
                <ReminderForm
                  submitLabel="Update"
                  initial={{
                    title: r.title,
                    date: isoDate(r.reminderAt),
                    time: hhmm(r.reminderAt),
                    leads: r.notifyLeadsMin,
                  }}
                  onCancel={() => onEdit(null)}
                  onSubmit={async (title, when, leads) => {
                    await onUpdate(r.id, title, when, leads);
                  }}
                />
              </li>
            ) : (
              <ReminderRow
                key={r.id}
                reminder={r}
                onEdit={() => {
                  setCreating(false);
                  onEdit(r.id);
                }}
                onDelete={() => onDelete(r.id)}
              />
            ),
          )
        )}
      </ul>
    </div>
  );
}

function ReminderRow({
  reminder,
  onEdit,
  onDelete,
}: {
  reminder: CalendarReminder;
  onEdit: () => void;
  onDelete: () => void;
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
          <span>{r.abs}</span>
        </div>
        <div className="mt-0.5 text-[10.5px] text-court-fg-muted">
          {leadsSummary(r.notifyLeadsMin)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Edit reminder"
          title="Edit"
          onClick={onEdit}
          className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Delete reminder"
          title="Delete"
          onClick={onDelete}
          className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

// Create + edit share this form. Date is a native picker; time uses the
// shared quarter-hour TimeSelect; notifications are a stackable list of
// lead presets (default a single 15-minute lead, up to three).
function ReminderForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: { title: string; date: string; time: string; leads: number[] };
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (title: string, reminderAt: Date, leads: number[]) => Promise<void>;
}) {
  const today = useMemo(() => new Date(), []);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? isoDate(today));
  const [time, setTime] = useState(initial?.time ?? nextQuarterHour(today));
  const [leads, setLeads] = useState<number[]>(
    initial && initial.leads.length > 0 ? initial.leads : [15],
  );
  const [submitting, setSubmitting] = useState(false);

  const sortedLeads = useMemo(
    () => leads.slice().sort((a, b) => b - a),
    [leads],
  );
  const available = LEAD_PRESETS.filter((p) => !leads.includes(p.value));
  const canAdd = leads.length < 3 && available.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !date || !time) return;
    const reminderAt = new Date(`${date}T${time}`);
    if (Number.isNaN(reminderAt.getTime())) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, reminderAt, leads);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2.5 border-b border-court-border-soft bg-court-surface-subtle px-5 py-3.5"
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
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-lg border border-court-border bg-court-surface px-2 py-1.5 text-[12px] text-court-fg outline-none focus:border-court-brand/60 focus:ring-2 focus:ring-court-brand/20"
        />
        <div className="flex-1">
          <TimeSelect value={time} onChange={setTime} ariaLabel="Reminder time" />
        </div>
      </div>

      {/* Notifications: stackable lead presets, default 15 min before. */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
          Notify
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sortedLeads.map((l) => (
            <span
              key={l}
              className="inline-flex items-center gap-1 rounded-full border border-court-brand/40 bg-court-brand-tint/50 px-2 py-0.5 text-[11px] font-semibold text-court-brand-dark"
            >
              {leadLabel(l)}
              <button
                type="button"
                aria-label={`Remove ${leadLabel(l)}`}
                onClick={() => setLeads((prev) => prev.filter((x) => x !== l))}
                className="text-court-brand-dark/70 hover:text-court-brand-dark"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
        {canAdd && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {available.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setLeads((prev) => [...prev, p.value])}
                className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:text-court-brand-dark"
              >
                <Plus className="h-2.5 w-2.5" />
                {p.label}
              </button>
            ))}
          </div>
        )}
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
          {submitting ? "Saving..." : submitLabel}
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

function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Next 15-minute boundary at or after `from`, so a new reminder opens on
// a slot the TimeSelect offers.
function nextQuarterHour(from: Date): string {
  const minutes = Math.ceil(from.getMinutes() / 15) * 15;
  const hour = (from.getHours() + Math.floor(minutes / 60)) % 24;
  const mins = minutes % 60;
  return `${pad(hour)}:${pad(mins)}`;
}
