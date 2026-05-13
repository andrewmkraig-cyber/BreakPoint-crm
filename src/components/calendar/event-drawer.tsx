"use client";

import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from "@/app/calendar/event-actions";
import { GoogleGlyph } from "@/components/calendar/left-rail";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  event: CalendarEvent | null;
  onClose: () => void;
};

// Convert a Date to the local "YYYY-MM-DD" and "HH:mm" strings the
// native date/time inputs expect. We treat all events as
// America/New_York since the rest of the calendar surface assumes
// ET; honoring the browser's tz would have us off by hours for
// recruiters who travel.
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${mm}`;
}
function fromDateTimeInput(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

// Used by the Location row to show an "open in new tab" affordance
// whenever the recruiter pastes a video link (Zoom, Teams, Webex,
// arbitrary) into the field. Tight check — the input still accepts
// addresses and room names; the link button just stays hidden when
// the value isn't a URL.
function isUrlLike(s: string): boolean {
  const v = s.trim();
  return /^https?:\/\/\S+$/i.test(v);
}

// Google Calendar stores some event descriptions as HTML (the Zoom +
// Teams meeting templates do this) and others as plain text. The
// drawer's Notes field uses these helpers to render HTML as a
// formatted preview and to downgrade to plain text when the
// recruiter clicks "Plain text" to edit.
function isHtmlDescription(s: string): boolean {
  return /<\/?(p|br|a|div|span|strong|em|b|i|u|ul|ol|li|h[1-6]|blockquote)\b/i.test(s);
}

// Allowlist sanitizer for description HTML. Strips script/style/
// iframe/object/embed wholesale (open + closed), every on* event
// handler attribute, and javascript:/data:/vbscript: hrefs. Adds
// target=_blank + rel=noreferrer to <a> tags so clicking an inline
// link doesn't replace the drawer with the meeting URL.
function sanitizeDescriptionHtml(s: string): string {
  let out = s;
  out = out.replace(
    /<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  out = out.replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, "");
  out = out.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(
    /(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi,
    '$1=$2#$2',
  );
  out = out.replace(/<a\b([^>]*?)>/gi, (_m, attrs) => {
    let a: string = attrs;
    if (!/target=/i.test(a)) a += ' target="_blank"';
    if (!/rel=/i.test(a)) a += ' rel="noreferrer"';
    return `<a${a}>`;
  });
  return out;
}

function htmlDescriptionToPlain(s: string): string {
  let out = s;
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<\/(div|h[1-6]|li|blockquote)>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const TYPE_OPTS: Array<{ id: CalendarEventType; label: string; sub: string }> = [
  {
    id: "interview",
    label: "Interview",
    sub: "Auto Google Meet · linked to job & candidate",
  },
  {
    id: "client",
    label: "Client Call",
    sub: "External · syncs to Google Calendar",
  },
  {
    id: "reminder",
    label: "Reminder",
    sub: "Personal · Ace-native toast notification",
  },
  { id: "other", label: "Other", sub: "Anything else" },
];

export function CalendarEventDrawer({ open, mode, event, onClose }: Props) {
  const router = useRouter();
  const [type, setType] = useState<CalendarEventType>(event?.type ?? "interview");
  const [title, setTitle] = useState(event?.title ?? "");
  const [reminderOn, setReminderOn] = useState(event?.reminderEnabled ?? false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  // Default to read-only HTML preview when the synced description is
  // HTML; otherwise jump straight into a plain-text textarea since
  // there's nothing to render. Clicking the Plain text toggle in HTML
  // mode downgrades `notes` to plain text and flips this true — once
  // a recruiter edits, formatting goes (and a save persists the plain
  // text to Google).
  const [notesPreviewMode, setNotesPreviewMode] = useState(false);
  const [newGuests, setNewGuests] = useState<GuestSuggestion[]>([]);
  const [saving, setSaving] = useState<null | "all" | "new">(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (event) {
      setType(event.type);
      setTitle(event.title);
      setDate(toDateInput(event.startTime));
      setStartTime(toTimeInput(event.startTime));
      setEndTime(toTimeInput(event.endTime));
      // The drawer's Location row prefers meetLink for display, but
      // when editing the user types a free-form location (room,
      // address, or a different Zoom URL) into the underlying field.
      setLocation(event.location ?? "");
      const incoming = event.meta ?? "";
      setNotes(incoming);
      setNotesPreviewMode(isHtmlDescription(incoming));
      setReminderOn(event.reminderEnabled ?? false);
    } else {
      setType("interview");
      setTitle("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setLocation("");
      setNotes("");
      setNotesPreviewMode(false);
      setReminderOn(false);
    }
    setNewGuests([]);
    setError(null);
  }, [event?.id, open]);

  const meta = eventTypeMeta(type);
  const headerLabel = mode === "edit" ? "Edit event" : "New event";
  const canSave =
    mode === "edit" &&
    event != null &&
    title.trim().length > 0 &&
    date.length > 0 &&
    startTime.length > 0 &&
    endTime.length > 0;

  async function doSave(notifyAll: boolean) {
    if (!event || !canSave) return;
    setSaving(notifyAll ? "all" : "new");
    setError(null);
    try {
      const startDate = fromDateTimeInput(date, startTime);
      const endDate = fromDateTimeInput(date, endTime);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid date or time.");
      }
      if (endDate.getTime() <= startDate.getTime()) {
        throw new Error("End time must be after start time.");
      }
      await updateCalendarEventAction({
        id: event.id,
        title: title.trim(),
        startISO: startDate.toISOString(),
        endISO: endDate.toISOString(),
        location: location.trim() || null,
        notes: notes.trim() || null,
        newGuests,
        notifyAll,
        reminderEnabled: reminderOn,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function doDelete() {
    if (!event) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this event? Attendees will be notified.")
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteCalendarEventAction({ id: event.id, notifyAll: true });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={headerLabel}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-court-border bg-court-surface shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-court-border px-6 pb-4 pt-5">
          <span
            className="mt-1.5 inline-block h-2 w-2 rounded-full"
            style={{ background: meta.dot, boxShadow: `0 0 0 4px ${meta.dot}22` }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
              {headerLabel}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled event"
              className="mt-1 w-full bg-transparent font-serif text-[22px] font-bold tracking-tight text-court-fg outline-none placeholder:text-court-fg-dim focus:outline-none"
            />
          </div>
          {mode === "edit" && event?.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
              title="Open in Google Calendar to edit or reschedule"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-court-border bg-court-surface px-3 text-[11.5px] font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
            >
              Open in Google <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Type selector */}
          <div>
            <FieldLabel>Event type</FieldLabel>
            <div className="grid grid-cols-4 gap-2">
              {TYPE_OPTS.map((t) => {
                const tm = eventTypeMeta(t.id);
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={cn(
                      "rounded-[10px] border px-3 py-2.5 text-left transition",
                      active
                        ? cn(tm.pillClass, "shadow-sm")
                        : "border-court-border bg-court-surface text-court-fg hover:border-court-brand/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: tm.dot }}
                      />
                      <span className="text-xs font-semibold">{t.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-[11.5px] text-court-fg-muted">
              {TYPE_OPTS.find((t) => t.id === type)?.sub}
            </div>
          </div>

          {/* Date / Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Date</FieldLabel>
              <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus-within:border-court-brand focus-within:ring-2 focus-within:ring-court-brand/20">
                <Calendar className="h-3.5 w-3.5 text-court-fg-muted" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="flex-1 bg-transparent text-[13.5px] text-court-fg outline-none"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Timezone</FieldLabel>
              <InputRow>
                <Globe className="h-3.5 w-3.5 text-court-fg-muted" />
                <span className="flex-1">America/New_York (ET)</span>
                <ChevronDown className="h-3 w-3 text-court-fg-muted" />
              </InputRow>
            </div>
            <div>
              <FieldLabel>Starts</FieldLabel>
              <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus-within:border-court-brand focus-within:ring-2 focus-within:ring-court-brand/20">
                <Clock className="h-3.5 w-3.5 text-court-fg-muted" />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="flex-1 bg-transparent text-[13.5px] text-court-fg outline-none"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Ends</FieldLabel>
              <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus-within:border-court-brand focus-within:ring-2 focus-within:ring-court-brand/20">
                <Clock className="h-3.5 w-3.5 text-court-fg-muted" />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 bg-transparent text-[13.5px] text-court-fg outline-none"
                />
              </div>
            </div>
          </div>

          {/* Guests */}
          <div>
            <FieldLabel>Guests</FieldLabel>
            <div className="space-y-1.5">
              {(event?.guests ?? []).length === 0 && (
                <div className="text-[11.5px] text-court-fg-muted">No guests.</div>
              )}
              {(event?.guests ?? []).map((g, i) => (
                <div
                  key={`${g}-${i}`}
                  className="flex items-center gap-2.5 rounded-[10px] border border-court-border px-3 py-2"
                >
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-court-surface-subtle text-[10px] font-bold text-court-fg">
                    {g.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-court-fg">{g}</span>
                </div>
              ))}
              <GuestTypeahead
                picked={newGuests}
                onChange={setNewGuests}
              />
            </div>
          </div>

          {/* Location / link */}
          <div>
            <FieldLabel>Location or link</FieldLabel>
            {event?.meetLink && (
              <a
                href={event.meetLink}
                target="_blank"
                rel="noreferrer"
                className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-court-brand-dark hover:underline"
              >
                <Video className="h-3 w-3" />
                {event.meetLink.replace(/^https?:\/\//, "")}
              </a>
            )}
            <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus-within:border-court-brand focus-within:ring-2 focus-within:ring-court-brand/20">
              <MapPin className="h-3 w-3 text-court-fg-muted" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Paste a Zoom link, address, or room"
                className="flex-1 bg-transparent text-[13.5px] text-court-fg outline-none placeholder:text-court-fg-dim"
              />
              {isUrlLike(location) && (
                <a
                  href={location.trim()}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open link in new tab"
                  title="Open link in new tab"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-court-brand-dark transition hover:bg-court-brand-tint/60"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Notes — Google Calendar event description */}
          <div>
            <div className="flex items-baseline justify-between">
              <FieldLabel>Notes</FieldLabel>
              {notesPreviewMode && (
                <button
                  type="button"
                  onClick={() => {
                    setNotes(htmlDescriptionToPlain(notes));
                    setNotesPreviewMode(false);
                  }}
                  className="text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
                >
                  Plain text
                </button>
              )}
            </div>
            {notesPreviewMode ? (
              <div
                className="max-h-[260px] overflow-auto rounded-[10px] border border-court-border bg-court-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-court-fg [&_a]:break-words [&_a]:text-court-brand-dark [&_a]:underline [&_h1]:my-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-[14.5px] [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{
                  __html: sanitizeDescriptionHtml(notes),
                }}
              />
            ) : (
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes for this event"
                className="w-full resize-none rounded-[10px] border border-court-border bg-court-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
              />
            )}
          </div>

          {/* Ace reminder toggle */}
          <div className="flex items-start gap-3 rounded-xl border border-court-border bg-court-surface p-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <Bell className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold text-court-fg">
                  Ace reminder
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reminderOn}
                  onClick={() => setReminderOn((v) => !v)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                    reminderOn ? "bg-brand" : "bg-court-fg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                      reminderOn ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
              <div className="mt-0.5 text-[11.5px] text-court-fg-muted">
                Fires as a toast inside Ace, 15 min before the event start.{" "}
                <span className="font-semibold text-court-brand-dark">Not synced</span>{" "}
                to Google.
              </div>
            </div>
          </div>

          {/* Google footer */}
          <div className="flex items-center gap-2 text-[11px] text-court-fg-muted">
            <GoogleGlyph className="h-3.5 w-3.5" /> Synced from Google Calendar
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-court-border bg-court-surface-subtle px-6 py-4">
          {error && (
            <div className="text-[12px] font-medium text-red-600 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            {mode === "edit" ? (
              <>
                <Button
                  variant="reject"
                  size="sm"
                  onClick={doDelete}
                  disabled={deleting || saving !== null}
                  aria-label="Delete event"
                  title="Delete"
                  className="!px-2"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
                <div className="flex-1" />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => doSave(false)}
                  disabled={
                    !canSave ||
                    saving !== null ||
                    deleting ||
                    newGuests.length === 0
                  }
                  title={
                    newGuests.length === 0
                      ? "Add a guest to enable — sends an invite to new guests only"
                      : "Patch silently for existing guests, email only the new ones"
                  }
                >
                  {saving === "new" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Save · notify new only
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => doSave(true)}
                  disabled={!canSave || saving !== null || deleting}
                >
                  {saving === "all" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save · notify all
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <div className="flex-1" />
                <Button
                  variant="primary"
                  size="sm"
                  disabled
                  title="Creating new events is coming next — for now use Google Calendar."
                >
                  <Plus className="h-3 w-3" /> Create event
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

type GuestSuggestion = { name: string; email: string };

// Typeahead for the drawer's guest field. Debounced query against
// /api/calendar/people-search; arrow-key navigation; Enter/click
// commits a pick. Picked state lives in the parent so Save can send
// the merged list to Google.
function GuestTypeahead({
  picked,
  onChange,
}: {
  picked: GuestSuggestion[];
  onChange: (next: GuestSuggestion[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GuestSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const pickedEmails = picked.map((p) => p.email.toLowerCase()).join(",");
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/calendar/people-search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { people?: GuestSuggestion[] };
        if (cancelled) return;
        const pickedSet = new Set(pickedEmails.split(",").filter(Boolean));
        const list = (body.people ?? []).filter(
          (p) => !pickedSet.has(p.email.toLowerCase()),
        );
        setSuggestions(list);
        setActiveIdx(0);
        setOpen(list.length > 0);
      } catch {
        // Silent — typeahead just stays closed.
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, pickedEmails]);

  function commit(p: GuestSuggestion) {
    onChange([...picked, p]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = suggestions[activeIdx];
      if (p) commit(p);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function initials(name: string, email: string) {
    const source = name.trim() || email.split("@")[0] || "?";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  return (
    <>
      {picked.map((p) => (
        <div
          key={p.email}
          className="flex items-center gap-2.5 rounded-[10px] border border-court-brand/40 bg-court-brand-tint/40 px-3 py-2"
        >
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-court-brand text-[10px] font-bold text-white">
            {initials(p.name, p.email)}
          </span>
          <span className="flex-1 truncate text-[13px] text-court-fg">
            {p.name || p.email}
          </span>
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-court-brand-dark">
            New
          </span>
          <button
            type="button"
            aria-label="Remove guest"
            onClick={() =>
              onChange(picked.filter((g) => g.email !== p.email))
            }
            className="text-court-fg-muted hover:text-court-fg"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          placeholder="Type a name from Ace candidates, contacts, or team"
          className="mt-1 h-[38px] w-full rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-[44px] z-20 max-h-[260px] overflow-auto rounded-md border border-court-border bg-court-surface py-1 shadow-lg">
            {suggestions.map((p, i) => (
              <li
                key={p.email}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(p);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-1.5",
                  i === activeIdx
                    ? "bg-court-brand-tint/60"
                    : "hover:bg-court-surface-subtle",
                )}
              >
                <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-court-surface-subtle text-[10px] font-bold text-court-fg">
                  {initials(p.name, p.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-court-fg">
                    {p.name || p.email}
                  </div>
                  {p.name && (
                    <div className="truncate text-[11.5px] text-court-fg-muted">
                      {p.email}
                    </div>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
      {children}
    </div>
  );
}

function InputRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg">
      {children}
    </div>
  );
}
