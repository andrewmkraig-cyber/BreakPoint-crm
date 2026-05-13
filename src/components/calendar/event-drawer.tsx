"use client";

import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Globe,
  MapPin,
  Plus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { GoogleGlyph } from "@/components/calendar/left-rail";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta, fmtTime } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  event: CalendarEvent | null;
  onClose: () => void;
};

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
  const [type, setType] = useState<CalendarEventType>(event?.type ?? "interview");
  const [title, setTitle] = useState(event?.title ?? "");
  const [reminderOn, setReminderOn] = useState(true);

  useEffect(() => {
    if (event) {
      setType(event.type);
      setTitle(event.title);
    } else {
      setType("interview");
      setTitle("");
    }
  }, [event?.id, open]);

  const meta = eventTypeMeta(type);
  const headerLabel = mode === "edit" ? "Edit event" : "New event";

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
              <InputRow>
                <Calendar className="h-3.5 w-3.5 text-court-fg-muted" />
                <span>
                  {event?.startTime
                    ? event.startTime.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </span>
              </InputRow>
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
              <InputRow>
                <Clock className="h-3.5 w-3.5 text-court-fg-muted" />
                <span>{event?.startTime ? fmtTime(event.startTime) : "—"}</span>
              </InputRow>
            </div>
            <div>
              <FieldLabel>Ends</FieldLabel>
              <InputRow>
                <Clock className="h-3.5 w-3.5 text-court-fg-muted" />
                <span>{event?.endTime ? fmtTime(event.endTime) : "—"}</span>
              </InputRow>
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
              <GuestTypeahead />
            </div>
          </div>

          {/* Location / link */}
          <div>
            <FieldLabel>Location or link</FieldLabel>
            <InputRow>
              {event?.meetLink ? (
                <>
                  <Video className="h-3 w-3 text-court-brand-dark" />
                  <a
                    href={event.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate font-medium text-court-brand-dark hover:underline"
                  >
                    {event.meetLink.replace(/^https?:\/\//, "")}
                  </a>
                </>
              ) : event?.location ? (
                <>
                  <MapPin className="h-3 w-3 text-court-fg-muted" />
                  <span className="flex-1 truncate text-court-fg">
                    {event.location}
                  </span>
                </>
              ) : (
                <>
                  <MapPin className="h-3 w-3 text-court-fg-muted" />
                  <span className="text-court-fg-muted">
                    Paste a Zoom link, address, or room
                  </span>
                </>
              )}
            </InputRow>
          </div>

          {/* Notes — Google Calendar event description */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              key={event?.id ?? "new"}
              rows={3}
              defaultValue={event?.meta ?? ""}
              placeholder="Add notes for this event"
              className="w-full resize-none rounded-[10px] border border-court-border bg-court-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
            />
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
                    "relative h-[18px] w-8 shrink-0 rounded-full transition",
                    reminderOn ? "bg-court-brand" : "bg-court-border",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 inline-block h-3.5 w-3.5 rounded-full bg-court-surface shadow transition-transform",
                      reminderOn ? "translate-x-4" : "translate-x-0.5",
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
        <div className="flex items-center gap-2.5 border-t border-court-border bg-court-surface-subtle px-6 py-4">
          {mode === "edit" ? (
            <>
              <button
                type="button"
                aria-label="Delete event"
                title="Delete"
                className="grid h-9 w-9 place-items-center rounded-full border border-court-border text-court-fg-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled
                title="Native edit-in-Ace is coming next — use Open in Google for now."
                className="h-9 cursor-not-allowed rounded-full border border-court-border bg-court-surface px-4 text-[12.5px] font-medium text-court-fg opacity-50"
              >
                Save · notify new only
              </button>
              <button
                type="button"
                disabled
                title="Native edit-in-Ace is coming next — use Open in Google for now."
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-full bg-court-brand px-4 text-[12.5px] font-semibold text-white opacity-60"
              >
                <Check className="h-3 w-3" /> Save · notify all
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-full border border-court-border bg-court-surface px-4 text-[12.5px] font-medium text-court-fg hover:border-court-brand/40 hover:bg-court-brand-tint"
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-court-brand px-4 text-[12.5px] font-semibold text-white hover:bg-court-brand-dark"
              >
                <Plus className="h-3 w-3" /> Create event
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

type GuestSuggestion = { name: string; email: string };

// Typeahead for the drawer's guest field. Debounced query against
// /api/calendar/people-search; arrow-key navigation; Enter/click
// commits a pick. The selected guest is held in local state — actual
// persistence to Google + Neon will land alongside the Save wiring
// in the next prompt slice.
function GuestTypeahead() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<GuestSuggestion[]>([]);
  const [suggestions, setSuggestions] = useState<GuestSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);

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
        const list = (body.people ?? []).filter(
          (p) => !picked.some((g) => g.email.toLowerCase() === p.email.toLowerCase()),
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
  }, [query, picked]);

  function commit(p: GuestSuggestion) {
    setPicked((prev) => [...prev, p]);
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
              setPicked((prev) => prev.filter((g) => g.email !== p.email))
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
