"use client";

import { Bell, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LeadTimePicker, leadsSummary } from "@/components/calendar/lead-time-picker";
import { TimeSelect } from "@/components/calendar/time-select";
import { Button } from "@/components/ui/button";
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
      {/* The list (and the create form when open) scrolls WITHIN the
          panel so 3+ reminders don't push the rail around - hover the
          panel and scroll. divide-y draws separators only BETWEEN rows,
          so there's never a line under the bottom-most reminder. */}
      <div className="max-h-[42vh] overflow-y-auto">
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
        <ul className="divide-y divide-court-border-soft">
          {reminders.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-court-fg-muted">
              No upcoming reminders.
            </li>
          ) : (
            reminders.map((r) =>
              editingId === r.id ? (
                <li key={r.id}>
                <ReminderForm
                  submitLabel="Update"
                  // Edit forms open either from the panel's own pencil or
                  // from a click on the reminder block out on the grid. In
                  // both cases the panel may be scrolled out of view at the
                  // bottom of the left rail, so reveal the full form (incl.
                  // the Update button) when it mounts.
                  scrollIntoViewOnMount
                  initial={{
                    title: r.title,
                    date: isoDate(r.reminderAt),
                    time: hhmm(r.reminderAt),
                    leads: r.notifyLeadsMin,
                  }}
                  onCancel={() => onEdit(null)}
                  onDelete={() => onDelete(r.id)}
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
    <li className="flex items-start gap-3 px-5 py-4">
      {/* Green bell avatar - reminder type indicator (far left). */}
      <div
        className={cn(
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full",
          r.urgent
            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            : "bg-court-brand-tint text-court-brand-dark",
        )}
      >
        <Bell className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {/* Line 1: title owns the entire content width and may wrap
            to a second line. Round 1 freed ~60px by pulling the
            countdown off this row; this round pulls the edit/delete
            buttons down to line 2 too, so a 21-char title like
            "Justin Bieber Pilates" fits comfortably without
            truncation. line-clamp-2 still caps anything pathological. */}
        <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-court-fg">
          {r.title}
        </div>
        {/* Line 2: countdown · bell + lead times, with the edit and
            delete buttons pinned to the right. Putting the buttons
            here keeps them visually anchored to the time line they
            modify, and leaves room for the title above to breathe. */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-court-fg-muted">
            <span
              className={cn(
                "whitespace-nowrap font-medium",
                r.urgent
                  ? "text-amber-700 dark:text-amber-200"
                  : "text-court-fg-muted",
              )}
            >
              {r.when}
            </span>
            <span aria-hidden className="opacity-50">·</span>
            <Bell className="h-3 w-3 shrink-0" />
            <span>{leadsSummary(r.notifyLeadsMin)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
        </div>
        {/* Line 3: full date/time, e.g. "Wednesday, May 20 at 12:00 PM". */}
        <div className="mt-0.5 text-[11px] text-court-fg-muted">{r.abs}</div>
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
  scrollIntoViewOnMount = false,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial?: { title: string; date: string; time: string; leads: number[] };
  submitLabel: string;
  // When true, focus the title field WITHOUT the browser's default
  // focus-scroll, then explicitly scroll the whole form to the center of
  // the viewport so its Cancel/Update row is never clipped at the bottom
  // of the left rail's scroll area.
  scrollIntoViewOnMount?: boolean;
  onCancel: () => void;
  onSubmit: (title: string, reminderAt: Date, leads: number[]) => Promise<void>;
  // Edit mode only. When present, a red Delete control sits in the sticky
  // footer alongside Cancel / Update so a reminder can be removed without
  // hunting for the row's separate trash button.
  onDelete?: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? isoDate(today));
  const [time, setTime] = useState(initial?.time ?? nextQuarterHour(today));
  const [leads, setLeads] = useState<number[]>(
    initial && initial.leads.length > 0 ? initial.leads : [15],
  );
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    if (scrollIntoViewOnMount) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Mount-only: the form remounts per open (keyed by reminder id), so the
    // reveal fires once each time the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      ref={formRef}
      onSubmit={handleSubmit}
      // The reminders panel body is the single scroll container now (so
      // 3+ reminders scroll within the panel), so the form just expands
      // inline; scrollIntoViewOnMount + scroll-my-4 reveal the full form
      // incl. its Delete/Cancel/Update row within that scroll area.
      className="scroll-my-4 bg-court-surface-subtle"
    >
      <div className="space-y-2.5 px-5 py-3.5">
        <input
          ref={titleRef}
          type="text"
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
          <LeadTimePicker leads={leads} onChange={setLeads} />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-court-border-soft bg-court-surface-subtle px-5 py-3">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-semibold text-court-fg-muted hover:text-court-fg"
        >
          Cancel
        </button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={submitting || !title.trim()}
        >
          {submitting ? "Saving…" : submitLabel}
        </Button>
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
