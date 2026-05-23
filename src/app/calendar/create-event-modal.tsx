"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  createCalendarEventAction,
  quickSearchContacts,
  type CreateMeetingType,
  type QuickContactSuggestion,
} from "./event-actions";

// Meeting-type dropdown options. Values mirror CreateMeetingType in
// event-actions.ts. Order chosen so the most-used types (Google Meet
// for client + candidate video calls) sit at the top.
const MEETING_TYPES: { value: CreateMeetingType; label: string }[] = [
  { value: "google_meet", label: "Google Meet" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "in_person", label: "In Person" },
  { value: "phone", label: "Phone Call" },
  { value: "none", label: "No Meeting" },
];

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// Round the prefill anchor up to the next quarter hour so the modal
// opens with a sensible default like 14:30, not 14:23.
function roundUpQuarter(d: Date): Date {
  const next = new Date(d);
  next.setSeconds(0, 0);
  const min = next.getMinutes();
  const rounded = Math.ceil(min / 15) * 15;
  if (rounded === 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  } else {
    next.setMinutes(rounded);
  }
  return next;
}

export type CreateEventModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  // Optional prefill from an empty-slot click on the grid; defaults to
  // "now, rounded up to the next quarter hour" when unset.
  prefill?: { date: Date; hour?: number; minute?: number } | null;
};

export function CreateEventModal({
  open,
  onClose,
  onCreated,
  prefill,
}: CreateEventModalProps) {
  const defaultStart = useMemo(() => {
    if (!prefill) return roundUpQuarter(new Date());
    const d = new Date(prefill.date);
    if (typeof prefill.hour === "number") {
      d.setHours(prefill.hour, prefill.minute ?? 0, 0, 0);
      return d;
    }
    return roundUpQuarter(new Date());
  }, [prefill]);
  const defaultEnd = useMemo(() => {
    const d = new Date(defaultStart.getTime() + 60 * 60 * 1000);
    return d;
  }, [defaultStart]);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toLocalDateString(defaultStart));
  const [startTime, setStartTime] = useState(toLocalTimeString(defaultStart));
  const [endTime, setEndTime] = useState(toLocalTimeString(defaultEnd));
  const [allDay, setAllDay] = useState(false);
  const [meetingType, setMeetingType] = useState<CreateMeetingType>("google_meet");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form whenever the modal is re-opened so a previous draft
  // doesn't survive across opens. The defaults recompute against the
  // current prefill so a grid-slot click lands on the right hour.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDate(toLocalDateString(defaultStart));
    setStartTime(toLocalTimeString(defaultStart));
    setEndTime(toLocalTimeString(defaultEnd));
    setAllDay(false);
    setMeetingType("google_meet");
    setLocation("");
    setNotes("");
    setTo([]);
    setCc([]);
    setBcc([]);
    setSubmitting(false);
    setErr(null);
  }, [open, defaultStart, defaultEnd]);

  async function onSubmit() {
    if (submitting) return;
    setErr(null);
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    setSubmitting(true);
    try {
      // Build the wall-clock as a local Date here so the server
      // receives a true UTC instant — Vercel's Node runtime parses
      // naive `date + time` strings as UTC and would skew the event
      // by the ET offset. Matches the drawer's create + edit paths.
      let startISO: string | undefined;
      let endISO: string | undefined;
      if (!allDay) {
        const startLocal = new Date(`${date}T${startTime}:00`);
        const endLocal = new Date(`${date}T${endTime}:00`);
        if (
          Number.isNaN(startLocal.getTime()) ||
          Number.isNaN(endLocal.getTime())
        ) {
          setErr("Invalid start/end time.");
          toast.error("Couldn't create event", {
            description: "Invalid start/end time.",
          });
          return;
        }
        startISO = startLocal.toISOString();
        endISO = endLocal.toISOString();
      }
      const res = await createCalendarEventAction({
        title: title.trim(),
        date,
        startISO,
        endISO,
        allDay,
        meetingType,
        location: meetingType === "in_person" ? location.trim() || null : null,
        notes: notes.trim() || null,
        // Candidate / client linkage was removed from this modal. The
        // action's signature still accepts them for any future caller
        // (e.g. a candidate-profile "Schedule" entry point); we pass
        // null here so this surface stays purely calendar-focused.
        candidateId: null,
        clientId: null,
        to,
        cc,
        bcc,
      });
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't create event", { description: res.error });
        return;
      }
      toast.success("Event created");
      onCreated?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Create calendar event"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-court-border backdrop-blur-sm bg-court-surface/95 shadow-[0_24px_64px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.15)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-2.5">
          <div>
            <h2 className="font-serif text-base font-semibold text-court-fg">
              New event
            </h2>
            <p className="mt-0.5 text-[11px] text-court-fg-muted">
              Creates a Google Calendar event and emails invites to any TO / CC / BCC addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-3 text-sm">
          <Field label="Title" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Intro call with Linda"
              disabled={submitting}
              autoFocus
              className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={submitting}
                className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
              />
            </Field>
            <Field label="All day">
              <label className="flex h-[34px] items-center gap-2 text-xs text-court-fg-muted">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  disabled={submitting}
                  className="h-4 w-4 cursor-pointer accent-brand"
                />
                Block the whole day
              </label>
            </Field>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
                />
              </Field>
              <Field label="End">
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
                />
              </Field>
            </div>
          )}

          <Field label="Meeting type">
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value as CreateMeetingType)}
              disabled={submitting}
              className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            >
              {MEETING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          {meetingType === "in_person" && (
            <Field label="Location">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="123 Main St, New York, NY"
                disabled={submitting}
                className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
              />
            </Field>
          )}

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Agenda, dial-in extras, prep links…"
              rows={2}
              disabled={submitting}
              className="w-full rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            />
          </Field>

          <Field label="To">
            <EmailChipInput
              value={to}
              onChange={setTo}
              disabled={submitting}
              search={quickSearchContacts}
            />
          </Field>

          <Field label="CC">
            <EmailChipInput
              value={cc}
              onChange={setCc}
              disabled={submitting}
              search={quickSearchContacts}
            />
          </Field>

          <Field label="BCC">
            <EmailChipInput
              value={bcc}
              onChange={setBcc}
              disabled={submitting}
              search={quickSearchContacts}
            />
          </Field>

          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-court-border px-5 py-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void onSubmit()}
            disabled={submitting || !title.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> Create event
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </div>
      {children}
    </label>
  );
}

// Free-text email tag input with optional Neon-backed typeahead.
//
// Manual entry: Enter or comma commits the typed value as a chip;
// Backspace on an empty input removes the last chip; the chip's ×
// removes it explicitly. Tab and blur commit pending text so a
// recruiter who types and tabs away doesn't drop the address.
// Values normalize via trim() and dedupe case-insensitively.
//
// Typeahead (when `search` is provided): once the draft hits 2+
// characters the component debounces a search call and renders a
// dropdown of matches. ArrowDown / ArrowUp navigate, Enter commits
// the highlighted row (or the typed draft when no row is highlighted),
// Escape dismisses the dropdown without clearing the draft. The
// dropdown filters out any suggestion whose email is already on the
// chip list so picking the same person twice isn't even offered.
//
// Used by the modal's TO / CC / BCC fields — Google Calendar doesn't
// natively distinguish those buckets in its attendees payload, so
// the split is purely a recruiter-side organization hint that the
// server action preserves in activity metadata only.
const SEARCH_DEBOUNCE_MS = 200;

function EmailChipInput({
  value,
  onChange,
  disabled,
  search,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  search?: (query: string) => Promise<QuickContactSuggestion[]>;
}) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<QuickContactSuggestion[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    const seen = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(p);
    }
    onChange(next);
    setDraft("");
    setSuggestions([]);
    setOpen(false);
    setHighlighted(-1);
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  // Debounced typeahead lookup. Empty / short queries skip the round
  // trip and close the dropdown. Already-selected emails are filtered
  // out of the suggestion list before render so the dropdown doesn't
  // offer dup candidates.
  useEffect(() => {
    if (!search) return;
    const q = draft.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await search(q);
        if (cancelled) return;
        const selected = new Set(value.map((v) => v.toLowerCase()));
        const filtered = rows.filter(
          (r) => !selected.has(r.email.toLowerCase()),
        );
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setHighlighted(filtered.length > 0 ? 0 : -1);
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setOpen(false);
          setHighlighted(-1);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, search, value]);

  // Outside-click dismiss for the dropdown. Scoped to the wrapper so
  // a click that happens to land on a row inside the dropdown is
  // already inside containerRef and doesn't close prematurely.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="flex min-h-[34px] w-full flex-wrap items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
      >
        {value.map((email, i) => (
          <span
            key={`${email}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] text-court-fg"
          >
            {email}
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              aria-label={`Remove ${email}`}
              className="text-court-fg-muted hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && open && suggestions.length > 0) {
              e.preventDefault();
              setHighlighted((h) => (h + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp" && open && suggestions.length > 0) {
              e.preventDefault();
              setHighlighted((h) =>
                h <= 0 ? suggestions.length - 1 : h - 1,
              );
              return;
            }
            if (e.key === "Escape" && open) {
              e.preventDefault();
              setOpen(false);
              setHighlighted(-1);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && highlighted >= 0 && suggestions[highlighted]) {
                commit(suggestions[highlighted].email);
              } else {
                commit(draft);
              }
              return;
            }
            if (e.key === ",") {
              e.preventDefault();
              commit(draft);
              return;
            }
            if (
              e.key === "Backspace" &&
              draft.length === 0 &&
              value.length > 0
            ) {
              removeAt(value.length - 1);
              return;
            }
            if (e.key === "Tab" && draft.trim().length > 0) {
              // Commit on Tab so focus moves AND the pending email
              // lands — without this, a recruiter who types one
              // address and tabs to the next field ships an event
              // without it.
              commit(draft);
            }
          }}
          onBlur={() => {
            // Blur commits the raw draft, NOT a highlighted suggestion
            // — picking from the dropdown is an explicit click/Enter
            // action. Without the draft check, clicking a row inside
            // the dropdown would race the blur and double-commit.
            if (draft.trim().length > 0) commit(draft);
          }}
          placeholder={value.length === 0 ? "email@example.com, …" : ""}
          disabled={disabled}
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none disabled:opacity-60"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={`${s.email}-${i}`}
              type="button"
              // Use mousedown not click so the commit happens BEFORE
              // the input's blur fires — otherwise blur's commit(draft)
              // races and may shadow the suggestion click.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.email);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={
                "block w-full truncate px-3 py-1.5 text-left text-xs transition " +
                (i === highlighted
                  ? "bg-court-accent-tint/60 text-court-fg"
                  : "text-court-fg hover:bg-court-accent-tint/40")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
