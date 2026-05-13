"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Loader2, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  getInterviewInviteState,
  updateInterviewInvite,
  type ClientContactSuggestion,
  type InviteParty,
} from "./interview-invite-actions";
import {
  cancelInterview,
  rescheduleInterview,
} from "@/app/candidates/[id]/interview-actions";
import { DateTime15Picker } from "@/components/datetime-15-picker";

// Inline edit-and-resend popup mounted on the dashboard. Loads the live
// calendar event for each party so the recruiter is editing what's
// actually on the calendar — not a stale local copy. Each party is its
// own form with To / Subject / Body and an independent Send button so
// resending the client invite without touching the candidate side is one
// click. Falls through to the canonical sendInterviewInvite when no
// per-party event exists yet (first send).
//
// Now also exposes a Schedule row at the top so the recruiter can move
// the interview (date/time/duration/timezone) or cancel it outright
// without bouncing to the candidate profile. Saving the schedule PATCHes
// every related Google event with sendUpdates=all; cancelling deletes
// all events and marks the row cancelled.

type Props = {
  interviewId: string;
  whenLabel: string;
  jobLabel: string;
  onClose: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      candidateName: string;
      scheduledAt: string;
      durationMin: number;
      clientName: string;
      clientContacts: ClientContactSuggestion[];
      client: InviteParty;
      candidate: InviteParty;
    };

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "UTC", label: "UTC" },
];

// Convert a wall-clock {date, time} entered as if in `tz` into the
// equivalent UTC instant. Uses Intl.DateTimeFormat to read the target
// timezone's offset for that instant (DST-aware) and shifts by the
// difference between the user's local offset and the target offset.
function wallClockInZoneToUTC(date: string, time: string, tz: string): Date {
  const naive = new Date(`${date}T${time}:00`);
  if (Number.isNaN(naive.getTime())) return naive;
  const targetOffsetMin = getTimezoneOffsetMinutes(tz, naive);
  const localOffsetMin = -naive.getTimezoneOffset();
  const deltaMin = localOffsetMin - targetOffsetMin;
  return new Date(naive.getTime() + deltaMin * 60 * 1000);
}

function getTimezoneOffsetMinutes(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const token =
    fmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = token.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hr = parseInt(m[2], 10);
  const min = parseInt(m[3] ?? "0", 10);
  return sign * (hr * 60 + min);
}

// Render a UTC instant as the wall-clock {date, time} as it would
// appear in `tz`. Used to seed the date/time inputs from the stored
// scheduledAt UTC.
function utcToWallClockInZone(iso: string, tz: string): { date: string; time: string } {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { date: "", time: "" };
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hr = get("hour");
  if (hr === "24") hr = "00";
  const time = `${hr}:${get("minute")}`;
  return { date, time };
}

function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function InterviewInvitePopup({ interviewId, whenLabel, jobLabel, onClose }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getInterviewInviteState(interviewId);
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error", error: result.error });
        return;
      }
      setState({
        status: "ready",
        candidateName: result.value.candidateName,
        scheduledAt: result.value.scheduledAt,
        durationMin: result.value.durationMin,
        clientName: result.value.clientName,
        clientContacts: result.value.clientContacts,
        client: result.value.client,
        candidate: result.value.candidate,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  function patchParty(party: "client" | "candidate", next: InviteParty) {
    setState((s) => (s.status === "ready" ? { ...s, [party]: next } : s));
  }

  return (
    <div
      role="dialog"
      aria-label="Edit calendar invite"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-base font-semibold text-court-fg">
              Edit calendar invite
            </h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">
              {whenLabel} · {jobLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state.status === "loading" && (
          <div className="flex items-center gap-2 py-10 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current invite…
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.error}
          </div>
        )}

        {state.status === "ready" && (
          <>
            <ScheduleEditor
              interviewId={interviewId}
              scheduledAt={state.scheduledAt}
              durationMin={state.durationMin}
              onClose={onClose}
            />

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <PartyForm
                title="Client invite"
                interviewId={interviewId}
                candidateName={state.candidateName}
                party={state.client}
                suggestions={state.clientContacts}
                onChange={(next) => patchParty("client", next)}
              />
              <PartyForm
                title="Candidate invite"
                interviewId={interviewId}
                candidateName={state.candidateName}
                party={state.candidate}
                suggestions={[]}
                onChange={(next) => patchParty("candidate", next)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleEditor({
  interviewId,
  scheduledAt,
  durationMin,
  onClose,
}: {
  interviewId: string;
  scheduledAt: string;
  durationMin: number;
  onClose: () => void;
}) {
  const [tz, setTz] = useState(defaultTimeZone);
  // Seed the date/time inputs from the stored UTC instant rendered in
  // the chosen timezone. Resets whenever the user picks a different TZ
  // so the wall-clock value the user reads matches the TZ they chose.
  const initial = useMemo(() => utcToWallClockInZone(scheduledAt, tz), [scheduledAt, tz]);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(String(durationMin));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // When the TZ changes, re-render the same UTC instant in the new TZ
  // so the inputs show the correct wall-clock for the picked zone.
  useEffect(() => {
    const next = utcToWallClockInZone(scheduledAt, tz);
    setDate(next.date);
    setTime(next.time);
  }, [tz, scheduledAt]);

  async function onSaveSchedule() {
    if (!date || !time) {
      toast.error("Pick a date and time");
      return;
    }
    const durMin = parseInt(duration, 10);
    if (!Number.isFinite(durMin) || durMin <= 0) {
      toast.error("Duration must be a positive number of minutes");
      return;
    }
    const when = wallClockInZoneToUTC(date, time, tz);
    if (Number.isNaN(when.getTime())) {
      toast.error("Invalid date/time");
      return;
    }
    setSavingSchedule(true);
    const result = await rescheduleInterview({
      interviewId,
      scheduledAt: when.toISOString(),
      durationMin: durMin,
      timeZone: tz,
    });
    setSavingSchedule(false);
    if (!result.ok) {
      toast.error("Reschedule failed", { description: result.error });
      return;
    }
    toast.success("Interview rescheduled", {
      description: "Google emailed every attendee the updated invite.",
    });
    onClose();
  }

  async function onCancelInterview() {
    const ok = window.confirm(
      "Cancel this interview? Google will email every attendee a cancellation notice and the row will move to Cancelled.",
    );
    if (!ok) return;
    setCancelling(true);
    const result = await cancelInterview(interviewId);
    setCancelling(false);
    if (!result.ok) {
      toast.error("Cancel failed", { description: result.error });
      return;
    }
    toast.success("Interview cancelled");
    onClose();
  }

  const busy = savingSchedule || cancelling;

  return (
    <section className="rounded-lg border border-court-border bg-court-surface-subtle/40 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          <Calendar className="h-3.5 w-3.5" /> Schedule
        </h3>
        <button
          type="button"
          onClick={onCancelInterview}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Cancel interview
        </button>
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="block md:col-span-1">
          <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Date &amp; time</span>
          <DateTime15Picker
            value={date && time ? `${date}T${time}` : ""}
            onChange={(next) => {
              if (!next) {
                setDate("");
                setTime("");
                return;
              }
              const [d, t] = next.split("T");
              setDate(d ?? "");
              setTime(t ?? "");
            }}
            disabled={busy}
            blockPast
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">
            Duration (min)
          </span>
          <input
            type="number"
            min={5}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Timezone</span>
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
          >
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSaveSchedule}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-accent bg-court-accent-tint px-3 py-1.5 text-xs font-semibold text-court-accent-dark transition hover:bg-court-accent/20 disabled:opacity-60"
        >
          {savingSchedule ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calendar className="h-3 w-3" />}
          Save schedule changes
        </button>
      </div>
    </section>
  );
}

function PartyForm({
  title,
  interviewId,
  candidateName,
  party,
  suggestions,
  onChange,
}: {
  title: string;
  interviewId: string;
  candidateName: string;
  party: InviteParty;
  suggestions: ClientContactSuggestion[];
  onChange: (next: InviteParty) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close the autocomplete dropdown on outside click. Inside-click goes
  // through onMouseDown handlers on each option to land the pick before
  // the input loses focus.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  const filtered = useMemo(() => {
    if (!suggestions.length) return [];
    const q = party.to.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions
      .filter(
        (s) =>
          s.email.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.title ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [suggestions, party.to]);

  async function onSend() {
    if (!party.to.trim()) {
      toast.error("Add a recipient", { description: "The To: field is empty." });
      return;
    }
    setBusy(true);
    const result = await updateInterviewInvite({
      interviewId,
      party: party.party,
      attendeeEmail: party.to.trim(),
      attendeeName: party.party === "candidate" ? candidateName : undefined,
      subject: party.subject,
      body: party.body,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(`${title} failed`, { description: result.error });
      return;
    }
    toast.success(party.hasEvent ? `${title} updated` : `${title} sent`, {
      description: party.hasEvent
        ? "Google emailed attendees the updated invite."
        : "Google emailed the native invite with Accept / Maybe / Decline.",
    });
    // Mark hasEvent true so the CTA flips from "Send" to "Resend" without
    // needing to refetch state from the server.
    onChange({ ...party, hasEvent: true });
  }

  return (
    <section className="rounded-lg border border-court-border bg-court-surface-subtle/40 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          {title}
        </h3>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            (party.hasEvent
              ? "bg-court-accent-tint text-court-accent-dark"
              : "bg-amber-100 text-amber-800")
          }
        >
          {party.hasEvent ? "Sent" : "Not sent"}
        </span>
      </header>

      <div ref={wrapRef} className="relative mb-2">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">To</span>
        <input
          type="email"
          value={party.to}
          onChange={(e) => {
            onChange({ ...party, to: e.target.value });
            if (suggestions.length) setPickerOpen(true);
          }}
          onFocus={() => {
            if (suggestions.length) setPickerOpen(true);
          }}
          disabled={busy}
          placeholder="name@example.com"
          className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
        {pickerOpen && filtered.length > 0 && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg"
          >
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  // onMouseDown so the selection lands before the input
                  // blur fires; preventDefault keeps focus on the input
                  // for continued editing.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ ...party, to: s.email });
                    setPickerOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-accent-tint/40"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{s.name}</span>
                    {s.title && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-court-fg-muted">
                        {s.title}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-court-fg-muted">{s.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Subject</span>
        <input
          type="text"
          value={party.subject}
          onChange={(e) => onChange({ ...party, subject: e.target.value })}
          disabled={busy}
          className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
      </label>

      <label className="block">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Description</span>
        <textarea
          value={party.body}
          onChange={(e) => onChange({ ...party, body: e.target.value })}
          disabled={busy}
          rows={8}
          className="w-full resize-y rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
      </label>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-accent bg-court-accent-tint px-3 py-1.5 text-xs font-semibold text-court-accent-dark transition hover:bg-court-accent/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {party.hasEvent ? "Resend invite" : "Send invite"}
        </button>
      </div>
    </section>
  );
}
