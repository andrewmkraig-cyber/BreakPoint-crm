"use client";

import {
  Bell,
  Calendar,
  Check,
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
import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
  type CreateMeetingType,
} from "@/app/calendar/event-actions";
import { createReminder } from "@/app/calendar/reminder-actions";
import { LeadTimePicker } from "@/components/calendar/lead-time-picker";
import { GoogleGlyph } from "@/components/calendar/left-rail";
import { TimeSelect } from "@/components/calendar/time-select";
import { Button } from "@/components/ui/button";
import { triggerCalendarSync } from "@/lib/calendar/trigger-sync";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  event: CalendarEvent | null;
  // Pre-fills the create form from a month-cell or day-slot click.
  // `hour` is optional (month view passes date only); when present,
  // the form defaults to a 1-hour block starting at that hour:minute.
  prefill?: { date: Date; hour?: number; minute?: number } | null;
  // Pre-picks the event type pill in create mode. The ComposeFAB's
  // "New Reminder" entry passes "reminder" so the drawer opens with
  // the right pill highlighted and a reminder-friendly meeting-type
  // default ("none"). null falls back to "interview".
  prefillType?: CalendarEventType | null;
  onClose: () => void;
};

const MEETING_TYPE_OPTS: Array<{ value: CreateMeetingType; label: string }> = [
  { value: "google_meet", label: "Google Meet" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "in_person", label: "In Person" },
  { value: "phone", label: "Phone Call" },
  { value: "none", label: "No Meeting" },
];

// IANA zones the recruiter can pick from. Default is Eastern since the
// rest of the calendar surface assumes ET; the four continental US
// zones cover where candidates and clients actually sit. Labels carry
// the common abbreviation so "PST" / "CST" map without the recruiter
// knowing the IANA name.
const TIMEZONE_OPTS: Array<{ value: string; label: string }> = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
];

const DEFAULT_TIMEZONE = "America/New_York";

// Reminders are Ace-native toasts with no timezone picker in the drawer,
// so their wall-clock time is anchored to Eastern. Hard-coded for now;
// once multi-user settings ship this should pull the signed-in user's
// per-user timezone preference instead of assuming ET.
const REMINDER_TIMEZONE = "America/New_York";

// Round a Date up to the next quarter hour so the create form opens
// at 14:30 instead of 14:23 when no slot prefill is supplied.
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

// The wall-clock the recruiter typed into the date/time inputs is
// meant in the timezone they picked from the selector, not the
// browser's. tzOffsetMs returns how far ahead of UTC `timeZone` sits
// at a given instant; zonedToInstant uses it to resolve a
// "YYYY-MM-DD" + "HH:mm" pair into the correct absolute instant. Two
// passes settle the DST edge where the offset differs between the
// naive guess and the resolved instant.
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour"),
    pick("minute"),
    pick("second"),
  );
  return asUTC - at.getTime();
}

function zonedToInstant(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map((n) => Number.parseInt(n, 10));
  const [h, mi] = time.split(":").map((n) => Number.parseInt(n, 10));
  const naiveUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const firstGuess = new Date(naiveUTC - tzOffsetMs(timeZone, new Date(naiveUTC)));
  return new Date(naiveUTC - tzOffsetMs(timeZone, firstGuess));
}

const REMINDER_DEFAULT_LEAD_MS = 15 * 60 * 1000;

// Reminders open pointed at roughly "15 minutes from now", then snapped
// up to the next quarter hour so the default lands on a slot the
// 15-minute picker actually offers.
function reminderDefaultTime(): Date {
  return roundUpQuarter(new Date(Date.now() + REMINDER_DEFAULT_LEAD_MS));
}

// STARTS / ENDS / reminder TIME use the shared quarter-hour TimeSelect
// (imported above) instead of native <input type="time">.
function minutesOf(time: string): number {
  const [h, m] = (time || "").split(":").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return Number.NaN;
  return h * 60 + m;
}

function timeFromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DURATION_PILLS: Array<{ label: string; minutes: number }> = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
  { label: "1 hr", minutes: 60 },
];

// Used by the Location row to show an "open in new tab" affordance
// whenever the recruiter pastes a video link (Zoom, Teams, Webex,
// arbitrary) into the field. Tight check - the input still accepts
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
    id: "candidate",
    label: "Candidate Call",
    sub: "Outbound to a candidate · syncs to Google Calendar",
  },
  {
    id: "reminder",
    label: "Reminder",
    sub: "Personal · Ace-native toast notification",
  },
  { id: "other", label: "Other", sub: "Anything else" },
];

export function CalendarEventDrawer({ open, mode, event, prefill, prefillType, onClose }: Props) {
  const router = useRouter();
  const [type, setType] = useState<CalendarEventType>(event?.type ?? "interview");
  const [title, setTitle] = useState(event?.title ?? "");
  // Default to ON in create mode - recruiters want a toast 15 min
  // before every new event unless they explicitly opt out. Edit mode
  // mirrors whatever the linked AceReminder row already has.
  const [reminderOn, setReminderOn] = useState(event?.reminderEnabled ?? true);
  // Stackable notification leads for create-mode reminders (Ace-native
  // path). Mirrors the reminders panel: default a single 15-min lead,
  // up to three. Only read when type === "reminder" on create.
  const [leads, setLeads] = useState<number[]>([15]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // Recruiter-pickable timezone for the wall-clock entered above. The
  // create/edit actions interpret startTime/endTime in this zone and
  // send Google both the resolved instant and this zone for display.
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);
  // Create-only: all-day blocks render in Google as a date range with
  // no time. Edit mode ignores this - Google's PATCH path through
  // updateCalendarEventAction always sends start/end as ISO timed
  // strings, so flipping allDay in edit would be a no-op against the
  // existing event.
  const [allDay, setAllDay] = useState(false);
  // Create-only meeting type. "google_meet" is the recruiter's
  // default; reminders override to "none" so a personal block doesn't
  // attach a video link.
  const [meetingType, setMeetingType] = useState<CreateMeetingType>("google_meet");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  // Default to read-only HTML preview when the synced description is
  // HTML; otherwise jump straight into a plain-text textarea since
  // there's nothing to render. Clicking the Plain text toggle in HTML
  // mode downgrades `notes` to plain text and flips this true - once
  // a recruiter edits, formatting goes (and a save persists the plain
  // text to Google).
  const [notesPreviewMode, setNotesPreviewMode] = useState(false);
  const [newGuests, setNewGuests] = useState<GuestSuggestion[]>([]);
  const [saving, setSaving] = useState<null | "all" | "new" | "none">(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The title control is a <textarea> so a long event title wraps
  // instead of clipping. Snap its height to scrollHeight on every
  // title change + on open so the field grows with content and
  // collapses back to one line when the recruiter clears it.
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, open]);

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
      setAllDay(false);
      setMeetingType("google_meet");
      setTimeZone(DEFAULT_TIMEZONE);
    } else {
      const initialType: CalendarEventType = prefillType ?? "interview";
      setType(initialType);
      setTitle("");
      setTimeZone(DEFAULT_TIMEZONE);
      if (initialType === "reminder") {
        // Reminder: a single TIME field defaulting to 15 min out. We
        // still seed endTime (start + 15 min) so switching to a timed
        // type later has a valid range instead of a blank Ends field.
        const start = reminderDefaultTime();
        setDate(toDateInput(prefill?.date ?? start));
        setStartTime(toTimeInput(start));
        setEndTime(
          toTimeInput(new Date(start.getTime() + REMINDER_DEFAULT_LEAD_MS)),
        );
      } else if (prefill) {
        // Month-cell clicks pass a date; day-slot clicks pass date +
        // hour + minute. Default end is one hour after start so the
        // form has a valid range without the recruiter having to tab
        // through both fields.
        setDate(toDateInput(prefill.date));
        if (prefill.hour != null) {
          const h = prefill.hour;
          const m = prefill.minute ?? 0;
          const pad = (n: number) => String(n).padStart(2, "0");
          setStartTime(`${pad(h)}:${pad(m)}`);
          const endHour = Math.min(23, h + 1);
          setEndTime(`${pad(endHour)}:${pad(m)}`);
        } else {
          const now = roundUpQuarter(new Date());
          setStartTime(toTimeInput(now));
          const end = new Date(now.getTime() + 60 * 60 * 1000);
          setEndTime(toTimeInput(end));
        }
      } else {
        // No prefill: open at "today, next quarter hour" so submit can
        // fire immediately without the recruiter typing a date.
        const now = roundUpQuarter(new Date());
        setDate(toDateInput(now));
        setStartTime(toTimeInput(now));
        const end = new Date(now.getTime() + 60 * 60 * 1000);
        setEndTime(toTimeInput(end));
      }
      setLocation("");
      setNotes("");
      setNotesPreviewMode(false);
      setReminderOn(true);
      setAllDay(false);
      // Personal reminders shouldn't attach a video link by default;
      // everything else opens with Google Meet pre-picked since most
      // recruiter calls are video.
      setMeetingType(initialType === "reminder" ? "none" : "google_meet");
      // Reminders open with the standard single 15-min lead.
      setLeads([15]);
    }
    setNewGuests([]);
    setError(null);
  }, [event?.id, open, prefill, prefillType]);

  const meta = eventTypeMeta(type);
  const isReminder = type === "reminder";
  const headerLabel = mode === "edit" ? "Edit event" : "New event";

  // Picking a type from the pill grid. In create mode, switching to
  // Reminder re-points the time at "15 min from now" and drops the
  // video link; switching back to a timed type restores Google Meet.
  // Edit mode leaves the existing time untouched.
  function pickType(next: CalendarEventType) {
    setType(next);
    if (mode !== "create") return;
    if (next === "reminder") {
      const start = reminderDefaultTime();
      setStartTime(toTimeInput(start));
      setEndTime(
        toTimeInput(new Date(start.getTime() + REMINDER_DEFAULT_LEAD_MS)),
      );
      setDate((d) => d || toDateInput(start));
      setMeetingType("none");
      // The all-day toggle is hidden for reminders; clear any prior
      // all-day choice so the Time field can't get stranded.
      setAllDay(false);
    } else {
      setMeetingType((m) => (m === "none" ? "google_meet" : m));
    }
  }

  // Changing STARTS shifts ENDS by the same delta so the meeting keeps
  // its current length. Reminders have no end field, so just set it.
  function handleStartChange(next: string) {
    if (isReminder) {
      setStartTime(next);
      return;
    }
    const prevStart = minutesOf(startTime);
    const prevEnd = minutesOf(endTime);
    const duration =
      Number.isNaN(prevStart) || Number.isNaN(prevEnd) || prevEnd <= prevStart
        ? 60
        : prevEnd - prevStart;
    setStartTime(next);
    setEndTime(timeFromMinutes(minutesOf(next) + duration));
  }

  // Duration pill sets ENDS to STARTS + the chosen length.
  function applyDuration(durationMin: number) {
    setEndTime(timeFromMinutes(minutesOf(startTime) + durationMin));
  }

  const currentDurationMin = (() => {
    const s = minutesOf(startTime);
    const e = minutesOf(endTime);
    return Number.isNaN(s) || Number.isNaN(e) || e <= s ? null : e - s;
  })();

  const canSave =
    mode === "edit" &&
    event != null &&
    title.trim().length > 0 &&
    date.length > 0 &&
    startTime.length > 0 &&
    (isReminder || endTime.length > 0);
  const canCreate =
    mode === "create" &&
    title.trim().length > 0 &&
    date.length > 0 &&
    (allDay || startTime.length > 0) &&
    (allDay || isReminder || endTime.length > 0);

  async function doSave(notifyMode: "all" | "new" | "none") {
    if (!event || !canSave) return;
    setSaving(notifyMode);
    setError(null);
    try {
      const startDate = zonedToInstant(date, startTime, timeZone);
      // Reminders carry no Ends field; pin a 15-min block so Google
      // and the validation below always have a valid range.
      const endDate = isReminder
        ? new Date(startDate.getTime() + REMINDER_DEFAULT_LEAD_MS)
        : zonedToInstant(date, endTime, timeZone);
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
        notifyMode,
        reminderEnabled: reminderOn,
        type,
        timeZone,
      });
      void triggerCalendarSync(router);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function doCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      // Reminders are Ace-native (toast-only, never pushed to Google),
      // so they write an AceReminder row directly instead of a Google
      // CalendarEvent. That row is what the Upcoming panel, the grid
      // pseudo-events, and the toast provider all read - a CalendarEvent
      // would never surface in the panel. The stacked NOTIFY leads ride
      // along so a FAB reminder matches a panel-created one.
      if (isReminder) {
        // Reminders have no timezone picker; anchor to ET via
        // REMINDER_TIMEZONE rather than the timeZone state (which may
        // still hold a value picked before the type switched to
        // reminder). Swap to the per-user timezone preference here once
        // multi-user settings ship.
        const when = zonedToInstant(date, startTime, REMINDER_TIMEZONE);
        if (Number.isNaN(when.getTime())) {
          throw new Error("Invalid date or time.");
        }
        await createReminder(title.trim(), when.toISOString(), leads);
        toast.success("Reminder created");
        router.refresh();
        onClose();
        return;
      }
      // Resolve the wall-clock in the recruiter-picked timezone into an
      // absolute instant, then hand the server toISOString(). Doing the
      // zone math here keeps the same startISO / endISO contract as
      // doSave; server-side parsing of naive datetime strings would
      // skew by the offset on Vercel's UTC Node runtime.
      let startISO: string | undefined;
      let endISO: string | undefined;
      if (!allDay) {
        const startDate = zonedToInstant(date, startTime, timeZone);
        // Reminders have no Ends field; pin a 15-min block.
        const endDate = isReminder
          ? new Date(startDate.getTime() + REMINDER_DEFAULT_LEAD_MS)
          : zonedToInstant(date, endTime, timeZone);
        if (
          Number.isNaN(startDate.getTime()) ||
          Number.isNaN(endDate.getTime())
        ) {
          throw new Error("Invalid date or time.");
        }
        if (endDate.getTime() <= startDate.getTime()) {
          throw new Error("End time must be after start time.");
        }
        startISO = startDate.toISOString();
        endISO = endDate.toISOString();
      }
      const res = await createCalendarEventAction({
        title: title.trim(),
        date,
        startISO,
        endISO,
        allDay,
        meetingType,
        timeZone,
        // Modal used to feed an "in person" address through this
        // field; the drawer's single Location row carries the same
        // value for any meeting type but the action only mirrors it
        // when meetingType is in_person, so guard here too.
        location: meetingType === "in_person" ? location.trim() || null : null,
        notes: notes.trim() || null,
        candidateId: null,
        clientId: null,
        // GuestTypeahead-picked rows go in TO; cc/bcc stay empty
        // per the unified design (one Guests bucket, not three).
        to: newGuests.map((g) => g.email),
        cc: [],
        bcc: [],
        type,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't create event", { description: res.error });
        return;
      }
      toast.success("Event created");
      void triggerCalendarSync(router);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
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
            {/* Auto-growing textarea so long titles wrap to multiple
                lines instead of clipping at the right edge. Font size
                + weight match the prior <input> exactly (22px / bold /
                serif); only the layout behavior changed. The
                useEffect below resets `height` to "auto" and then
                snaps it to scrollHeight every render so the control
                grows as the recruiter types and shrinks back when
                they delete. rows={1} keeps the empty state a single
                line. */}
            <textarea
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={1}
              className="mt-1 w-full resize-none overflow-hidden break-words bg-transparent font-serif text-[22px] font-bold leading-tight tracking-tight text-court-fg outline-none placeholder:text-court-fg-dim focus:outline-none"
            />
          </div>
          {mode === "edit" && event?.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
              title="Open in Google Calendar to edit or reschedule"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 text-[11.5px] font-medium text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
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
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTS.map((t) => {
                const tm = eventTypeMeta(t.id);
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickType(t.id)}
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
            {/* Reminders hide the timezone selector and fire in ET (see
                the hard-coded REMINDER_TIMEZONE in doCreate). Timed events
                keep the picker. */}
            {!isReminder && (
              <div>
                <FieldLabel>Timezone</FieldLabel>
                <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus-within:border-court-brand focus-within:ring-2 focus-within:ring-court-brand/20">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
                  <select
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    className="flex-1 bg-transparent text-[13.5px] text-court-fg outline-none"
                  >
                    {TIMEZONE_OPTS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {!allDay && isReminder && (
              <div>
                <FieldLabel>Time</FieldLabel>
                <TimeSelect
                  value={startTime}
                  onChange={setStartTime}
                  ariaLabel="Reminder time"
                />
              </div>
            )}
            {!allDay && !isReminder && (
              <>
                <div>
                  <FieldLabel>Starts</FieldLabel>
                  <TimeSelect
                    value={startTime}
                    onChange={handleStartChange}
                    ariaLabel="Start time"
                  />
                </div>
                <div>
                  <FieldLabel>Ends</FieldLabel>
                  <TimeSelect
                    value={endTime}
                    onChange={setEndTime}
                    ariaLabel="End time"
                  />
                </div>
              </>
            )}
          </div>

          {/* Duration pills (timed events only). Clicking sets ENDS to
              STARTS + the chosen length; the active pill reflects the
              current span. */}
          {!allDay && !isReminder && (
            <div>
              <FieldLabel>Duration</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {DURATION_PILLS.map((d) => {
                  const active = currentDurationMin === d.minutes;
                  return (
                    <button
                      key={d.minutes}
                      type="button"
                      onClick={() => applyDuration(d.minutes)}
                      className={cn(
                        "rounded-md border px-3 py-1 text-xs font-semibold transition",
                        active
                          ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                          : "border-court-border bg-court-surface text-court-fg hover:border-court-brand/40",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* All-day + meeting type (create only). All-day is a
              create-time choice - Google's PATCH path the edit
              flow uses doesn't switch a timed event to all-day, so
              hiding the toggle in edit avoids a no-op control.
              Reminders hide both: a personal Ace toast has no all-day
              span and no video link. */}
          {mode === "create" && !isReminder && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>All day</FieldLabel>
                <label className="flex h-[38px] items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-[12.5px] text-court-fg-muted">
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer accent-court-brand"
                  />
                  Block the whole day
                </label>
              </div>
              <div>
                <FieldLabel>Meeting type</FieldLabel>
                <select
                  value={meetingType}
                  onChange={(e) => setMeetingType(e.target.value as CreateMeetingType)}
                  className="h-[38px] w-full rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg focus:border-court-brand focus:outline-none focus:ring-2 focus:ring-court-brand/20"
                >
                  {MEETING_TYPE_OPTS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Guests - hidden for reminders; a personal Ace toast has no
              invitees. */}
          {!isReminder && (
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
          )}

          {/* Location / link - hidden for reminders; a personal toast
              carries no address or video link. */}
          {!isReminder && (
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
          )}

          {/* Notes - Google Calendar event description */}
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
                className="w-full resize-none rounded-[10px] border border-court-border bg-court-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
              />
            )}
          </div>

          {/* Create-mode reminders configure their own toast schedule via
              the shared stackable lead picker (same UI as the reminders
              panel). Every other case keeps the single on/off toggle that
              attaches a 15-min reminder to a Google event. */}
          {mode === "create" && isReminder ? (
            <div>
              <FieldLabel>Notify</FieldLabel>
              <LeadTimePicker leads={leads} onChange={setLeads} />
              <div className="mt-1.5 text-[11.5px] text-court-fg-muted">
                Fires as a toast inside Ace.{" "}
                <span className="font-semibold text-court-brand-dark">Not synced</span>{" "}
                to Google.
              </div>
            </div>
          ) : (
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
          )}

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
                  onClick={() => doSave("none")}
                  disabled={!canSave || saving !== null || deleting}
                  title="Patch Google silently - no emails go out, not even to new guests"
                >
                  {saving === "none" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Save
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => doSave("new")}
                  disabled={
                    !canSave ||
                    saving !== null ||
                    deleting ||
                    newGuests.length === 0
                  }
                  title={
                    newGuests.length === 0
                      ? "Add a guest to enable - sends an invite to new guests only"
                      : "Patch silently for existing guests, email only the new ones"
                  }
                >
                  {saving === "new" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Save
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => doSave("all")}
                  disabled={!canSave || saving !== null || deleting}
                  title="Patch Google and email all guests about the change"
                >
                  {saving === "all" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <div className="flex-1" />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void doCreate()}
                  disabled={!canCreate || creating}
                >
                  {creating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Create event
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
        // Silent - typeahead just stays closed.
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
