"use client";

import {
  Bell,
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Globe,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
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
    id: "personal",
    label: "Reminder",
    sub: "Personal · Ace-native toast notification",
  },
  { id: "other", label: "Other", sub: "Anything else" },
];

export function CalendarEventDrawer({ open, mode, event, onClose }: Props) {
  const [type, setType] = useState<CalendarEventType>(event?.type ?? "interview");
  const [title, setTitle] = useState(event?.title ?? "");
  const [reminderOn, setReminderOn] = useState(true);
  const [newGuestAdded, setNewGuestAdded] = useState(false);

  useEffect(() => {
    if (event) {
      setType(event.type);
      setTitle(event.title);
    } else {
      setType("interview");
      setTitle("");
    }
    setNewGuestAdded(false);
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

          {/* Interview-specific block */}
          {type === "interview" && (
            <div className="rounded-xl border border-dashed border-court-brand/40 bg-court-brand-tint/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-court-brand-dark" />
                <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-court-brand-dark">
                  Interview details
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Job</FieldLabel>
                  <InputRow>
                    <Briefcase className="h-3 w-3 text-court-brand-dark" />
                    <span className="flex-1 truncate">Controller</span>
                    <ChevronDown className="h-3 w-3 text-court-fg-muted" />
                  </InputRow>
                  <div className="mt-1 text-[10.5px] text-court-fg-muted">
                    Capstone Accounting &amp; Tax
                  </div>
                </div>
                <div>
                  <FieldLabel>Candidate</FieldLabel>
                  <InputRow>
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-court-fg text-[9px] font-bold text-court-surface">
                      MR
                    </span>
                    <span className="flex-1 truncate">Marcus Reed</span>
                    <ChevronDown className="h-3 w-3 text-court-fg-muted" />
                  </InputRow>
                  <div className="mt-1 text-[10.5px] text-court-fg-muted">
                    Auto-filled from Job
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Guests */}
          <div>
            <div className="flex items-baseline justify-between">
              <FieldLabel>Guests</FieldLabel>
              <button
                type="button"
                onClick={() => setNewGuestAdded(true)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
              >
                <Plus className="h-3 w-3" /> Add from Ace
              </button>
            </div>
            <div className="space-y-1.5">
              {(event?.guests ?? ["Marcus Reed", "Diana Wu"]).map((g, i) => (
                <div
                  key={`${g}-${i}`}
                  className="flex items-center gap-2.5 rounded-[10px] border border-court-border px-3 py-2"
                >
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-court-surface-subtle text-[10px] font-bold text-court-fg">
                    {g.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-court-fg">{g}</span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted">
                    {i === 0 ? "Candidate" : "Client"}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove guest"
                    className="text-court-fg-muted hover:text-court-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {newGuestAdded && (
                <div className="flex items-center gap-2.5 rounded-[10px] border border-court-brand/40 bg-court-brand-tint/40 px-3 py-2">
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-court-brand text-[10px] font-bold text-white">
                    JT
                  </span>
                  <span className="flex-1 truncate text-[13px] text-court-fg">
                    Jordan Tate
                  </span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-court-brand-dark">
                    New · Team
                  </span>
                  <button
                    type="button"
                    aria-label="Remove guest"
                    className="text-court-fg-muted hover:text-court-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <input
                placeholder="Type a name from Ace candidates, contacts, or team"
                className="mt-1 h-[38px] w-full rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
              />
            </div>
          </div>

          {/* Meet / location */}
          <div>
            <FieldLabel>
              {type === "interview" ? "Meeting link" : "Location or link"}
            </FieldLabel>
            {type === "interview" ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-court-brand/40 bg-court-brand-tint/40 p-3">
                <div className="grid h-8 w-8 place-items-center rounded-md border border-court-border bg-court-surface">
                  <GoogleGlyph className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-court-fg">
                    meet.google.com/abc-defg-hij
                  </div>
                  <div className="text-[10.5px] text-court-fg-muted">
                    Auto-generated for Interview events
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-court-brand-dark hover:text-court-brand"
                >
                  Copy
                </button>
              </div>
            ) : (
              <InputRow>
                <MapPin className="h-3 w-3 text-court-fg-muted" />
                <span className="text-court-fg-muted">
                  Paste a Zoom link, address, or room
                </span>
              </InputRow>
            )}
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              rows={3}
              defaultValue="Final round. Diana wants to dig into the SOX exposure and how Marcus would lead month-end close. Send the brief 30 min before."
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
                Fires as a toast inside Ace · Tue May 12, 9:45 AM (15m before).{" "}
                <span className="font-semibold text-court-brand-dark">Not synced</span>{" "}
                to Google.
              </div>
            </div>
          </div>

          {/* Google footer */}
          <div className="flex items-center gap-2 text-[11px] text-court-fg-muted">
            <GoogleGlyph className="h-3.5 w-3.5" /> Synced to Andrew&apos;s Google
            Calendar · last updated 2 min ago
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
                disabled={!newGuestAdded}
                title={
                  newGuestAdded
                    ? "Notify only the newly-added guests"
                    : "Add a guest to enable"
                }
                className={cn(
                  "h-9 rounded-full border border-court-border bg-court-surface px-4 text-[12.5px] font-medium text-court-fg",
                  !newGuestAdded && "cursor-not-allowed opacity-50",
                  newGuestAdded && "hover:border-court-brand/40 hover:bg-court-brand-tint",
                )}
              >
                Save · notify new only
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-court-brand px-4 text-[12.5px] font-semibold text-white hover:bg-court-brand-dark"
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
