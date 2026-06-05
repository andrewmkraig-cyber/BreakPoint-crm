import { dedupeCalendarRows } from "@/lib/calendar/dedupe";
import { ownerKeyForCalendar } from "@/lib/calendar/owner-key";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { prisma } from "@/lib/prisma";
import { getEasternWeekBounds } from "@/lib/week";

import type {
  DayCell,
  LaterRow,
  UpNextRow,
  WeekViewData,
} from "./this-week-widget-client";

// Data layer for the Court-mode "This Week" widget. Lives apart from the
// server component + client component so the `use server` action
// (this-week-actions.ts) and the server component can both call
// getWeekData without forming a use-server/use-client import cycle.
//
// getWeekData fetches + pre-formats every label server-side so SSR and
// hydration agree byte-for-byte. weekOffset shifts the Mon-Fri window by
// whole weeks off the current week; offset 0 is the current week and is
// the only week that renders the today-centric sections.

const ZONE = "America/New_York";

type AttendeeJson = { displayName?: string; email?: string };

// Same derivation rule the Calendar page uses - the schema does not
// carry an event type, so we infer from title + calendar name.
function deriveType(title: string, calendarName: string): CalendarEventType {
  const t = title.toLowerCase();
  const c = calendarName.toLowerCase();
  if (t.includes("interview")) return "interview";
  if (
    t.includes("call") ||
    t.includes("meeting") ||
    t.includes("sync") ||
    t.includes("connect") ||
    t.includes("chat")
  ) {
    return "client";
  }
  if (c.includes("reminder") || t.includes("reminder")) return "reminder";
  return "other";
}

function interviewRowPreference(row: {
  title: string;
  calendarName: string;
  typeOverride?: string | null;
}): number {
  const override = row.typeOverride as CalendarEventType | null;
  if (override === "interview") return 0;
  const derived = deriveType(row.title, row.calendarName);
  if (derived === "interview") return 1;
  return 2;
}

function formatYMD(d: Date): string {
  // YYYY-MM-DD in ET - used to bucket events by day. formatToParts
  // avoids depending on en-US's default M/D/Y string ordering.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatTimeLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function formatLongDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

function formatMonthLong(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "long",
  }).format(d);
}

function formatWeekdayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
  }).format(d);
}

function formatDayNum(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    day: "numeric",
  }).format(d);
}

// Heading for a non-current week: "June 8 – 12" (or "June 30 – July 4"
// when the Mon-Fri span crosses a month). En dash, never em dash.
function formatWeekRange(weekStart: Date): string {
  const mon = new Date(weekStart.getTime() + 12 * 60 * 60 * 1000);
  const fri = new Date(weekStart.getTime() + 4 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  const monMonth = formatMonthLong(mon);
  const friMonth = formatMonthLong(fri);
  const monDay = formatDayNum(mon);
  const friDay = formatDayNum(fri);
  return monMonth === friMonth
    ? `${monMonth} ${monDay} – ${friDay}`
    : `${monMonth} ${monDay} – ${friMonth} ${friDay}`;
}

// "Next in" copy with three buckets so a multi-day-out next event
// never renders as "Next in 2742 min".
function formatNextIn(now: Date, then: Date): string | null {
  const diffMs = then.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffMin < 24 * 60) return `${diffHr} hr`;
  const diffDays = Math.round(diffMin / (24 * 60));
  return `${diffDays} day${diffDays === 1 ? "" : "s"}`;
}

function formatDurationLabel(min: number): string {
  if (min <= 0) return "";
  if (min < 60) return `${min} MIN`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${hr} HR`;
  return `${hr}H ${m}M`;
}

// Secondary line under the event title in the Up Next / Later rows.
// Prefer location (most concrete), then guest list (truncated to two),
// then the calendar name as a last-resort label. Andrew's own identity
// (his email shows up as a sole attendee and as his primary calendar's
// name) is filtered out everywhere - the dashboard is his own view, so
// "andrew@breakpointtalent.com" under every event is just noise.
function deriveRowMeta(
  ev: CalendarEvent,
  self: { name: string | null; email: string | null },
): string {
  const selfKeys = new Set(
    [self.email, self.name]
      .filter((s): s is string => Boolean(s && s.trim()))
      .map((s) => s.trim().toLowerCase()),
  );
  const isSelf = (s: string) => selfKeys.has(s.trim().toLowerCase());

  if (ev.location && ev.location.trim().length > 0) return ev.location.trim();
  if (ev.guests && ev.guests.length > 0) {
    const others = ev.guests.filter((g) => g.trim().length > 0 && !isSelf(g));
    if (others.length > 0) return others.slice(0, 2).join(" · ");
  }
  if (ev.calendarName && !isSelf(ev.calendarName)) return ev.calendarName;
  return "";
}

export async function getWeekData(
  orgId: string,
  selfPerson: { name: string | null; email: string | null },
  weekOffset: number,
): Promise<WeekViewData> {
  const now = new Date();
  const { start: curWeekStart } = getEasternWeekBounds(now);
  // Shift whole weeks off the current Monday, re-anchored at ~noon so a
  // DST transition inside the jump can't bump weekStart into the
  // adjacent week. getEasternWeekBounds then snaps back to Monday 00:00 ET.
  const targetAnchor = new Date(
    curWeekStart.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
  );
  const { start: weekStart } = getEasternWeekBounds(targetAnchor);
  // Saturday 00:00 ET - exclusive end of the Mon-Fri window.
  const weekEnd = new Date(weekStart.getTime() + 5 * 24 * 60 * 60 * 1000);
  const isCurrentWeek = weekOffset === 0;

  const [
    rowsAll,
    eventLinkedReminders,
    standaloneReminders,
    cancelledInterviews,
    activeInterviews,
  ] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        organizationId: orgId,
        status: { not: "CANCELLED" },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      orderBy: { startTime: "asc" },
    }),
    // Drives the drawer's "Ace reminder" toggle when the user opens an
    // event from the dashboard tile. Without this, the toggle initializes
    // to the default (off) regardless of what's actually persisted.
    prisma.aceReminder.findMany({
      where: {
        organizationId: orgId,
        dismissed: false,
        calendarEventId: { not: null },
      },
      select: { calendarEventId: true },
    }),
    // Standalone panel reminders this week, rendered on the widget as
    // reminder-type pseudo-events alongside calendar events.
    prisma.aceReminder.findMany({
      where: {
        organizationId: orgId,
        dismissed: false,
        calendarEventId: null,
        interviewId: null,
        reminderAt: { gte: weekStart, lt: weekEnd },
      },
      orderBy: { reminderAt: "asc" },
      select: { id: true, title: true, reminderAt: true },
    }),
    prisma.interview.findMany({
      where: {
        organizationId: orgId,
        status: "cancelled",
        scheduledAt: { gte: weekStart, lt: weekEnd },
        OR: [
          { googleEventIdMine: { not: null } },
          { googleEventIdClient: { not: null } },
          { googleEventIdCandidate: { not: null } },
        ],
      },
      select: {
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
      },
    }),
    prisma.interview.findMany({
      where: {
        organizationId: orgId,
        status: { not: "cancelled" },
        scheduledAt: { gte: weekStart, lt: weekEnd },
        OR: [
          { googleEventIdMine: { not: null } },
          { googleEventIdClient: { not: null } },
          { googleEventIdCandidate: { not: null } },
        ],
      },
      select: {
        id: true,
        candidateId: true,
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
        sentCandidateSubject: true,
        sentCandidateBody: true,
        sentClientSubject: true,
        sentClientBody: true,
      },
    }),
  ]);
  const cancelledGoogleEventIds = new Set(
    cancelledInterviews
      .flatMap((iv) => [iv.googleEventIdMine, iv.googleEventIdClient, iv.googleEventIdCandidate])
      .filter((id): id is string => Boolean(id)),
  );
  const activeRowsAll = rowsAll.filter((row) => !cancelledGoogleEventIds.has(row.googleEventId));
  // Mirror the /calendar enrichment: each interview-owned googleEventId maps
  // to its Interview.id + party + the verbatim sent copy, so the drawer the
  // widget opens shows "what the recipient saw" and the interview-aware Edit
  // / Cancel. The widget still collapses to ONE row per interview below; this
  // only enriches the event object that the single chosen row carries.
  type InterviewEventMeta = {
    interviewId: string;
    candidateId: string | null;
    party: "candidate" | "client" | "none";
    sentSubject?: string;
    sentBody?: string;
  };
  const interviewMetaByGoogleEventId = new Map<string, InterviewEventMeta>();
  const interviewIdByGoogleEventId = new Map<string, string>();
  for (const iv of activeInterviews) {
    if (iv.googleEventIdCandidate) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdCandidate, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "candidate",
        sentSubject: iv.sentCandidateSubject ?? undefined,
        sentBody: iv.sentCandidateBody ?? undefined,
      });
    }
    if (iv.googleEventIdClient) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdClient, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "client",
        sentSubject: iv.sentClientSubject ?? undefined,
        sentBody: iv.sentClientBody ?? undefined,
      });
    }
    if (iv.googleEventIdMine && !interviewMetaByGoogleEventId.has(iv.googleEventIdMine)) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdMine, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "none",
      });
    }
    for (const id of [iv.googleEventIdMine, iv.googleEventIdClient, iv.googleEventIdCandidate]) {
      if (id) interviewIdByGoogleEventId.set(id, iv.id);
    }
  }
  const eventsWithReminders = new Set(
    eventLinkedReminders
      .map((r) => r.calendarEventId)
      .filter((id): id is string => id != null),
  );

  // Clubhouse widget is Andrew's view - strip any row whose owner key
  // resolves to anything other than "ak". Austin's events stay on
  // /calendar (team view) but never appear on this dashboard tile.
  const akRows = activeRowsAll.filter(
    (r) =>
      ownerKeyForCalendar(
        { calendarId: r.calendarId, calendarName: r.calendarName },
        selfPerson,
      ) === "ak",
  );

  // Dedupe by googleEventId (same event mirrored on multiple of
  // Andrew's calendars) and by a title|start|end|meetLink fallback for
  // the cross-calendar case where Google minted distinct event ids for
  // the same invite — until CalendarEvent.iCalUID is available the
  // composite key is our defense against the duplicate-row symptom on
  // the "This Week" strip.
  const dedupedRows = dedupeCalendarRows(akRows);

  // Ace-scheduled interviews intentionally create separate Google
  // events for the candidate and client so each party gets the right
  // invite body. The Clubhouse widget should still show one logical
  // interview, so collapse all Google event ids that belong to the same
  // Interview row.
  const bestInterviewRows = new Map<string, (typeof dedupedRows)[number]>();
  const nonInterviewRows: typeof dedupedRows = [];
  for (const row of dedupedRows) {
    const interviewId = interviewIdByGoogleEventId.get(row.googleEventId);
    if (!interviewId) {
      nonInterviewRows.push(row);
      continue;
    }
    const existing = bestInterviewRows.get(interviewId);
    if (!existing || interviewRowPreference(row) < interviewRowPreference(existing)) {
      bestInterviewRows.set(interviewId, row);
    }
  }
  const rows = [...nonInterviewRows, ...Array.from(bestInterviewRows.values())].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );

  // Full CalendarEvent objects in the same shape the /calendar page
  // produces - passed through to the drawer when a chip or row is
  // clicked.
  const events: CalendarEvent[] = rows.map((row) => {
    const attendees = (row.attendees as AttendeeJson[] | null) ?? null;
    const guests = attendees
      ? attendees
          .map((a) => (a.displayName ?? a.email ?? "").trim())
          .filter((s) => s.length > 0)
      : undefined;
    const overrideType = row.typeOverride as CalendarEventType | null;
    const interviewMeta = interviewMetaByGoogleEventId.get(row.googleEventId);
    const linkedInterview = interviewMeta != null;
    const displayTitle = interviewMeta?.sentSubject ?? row.title;
    const displayMeta = interviewMeta?.sentBody ?? row.description ?? undefined;
    return {
      id: row.id,
      title: displayTitle,
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: row.allDay,
      type: linkedInterview ? "interview" : overrideType ?? deriveType(row.title, row.calendarName),
      meta: displayMeta,
      guests,
      location: row.location ?? undefined,
      ownerKeys: ["ak"],
      jobId: row.jobId ?? undefined,
      candidateId: interviewMeta?.candidateId ?? row.candidateId ?? undefined,
      clientId: row.clientId ?? undefined,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor ?? undefined,
      meetLink: row.meetLink ?? undefined,
      htmlLink: row.htmlLink ?? undefined,
      reminderEnabled: eventsWithReminders.has(row.id),
      interviewId: interviewMeta?.interviewId,
      interviewParty: interviewMeta?.party,
      sentSubject: interviewMeta?.sentSubject,
      sentBody: interviewMeta?.sentBody,
    };
  });

  // Standalone reminders as reminder-type pseudo-events. 30-min visual
  // block; aceReminderId tells the client to deep-link to /calendar
  // (where they're edited) instead of opening the event drawer.
  for (const r of standaloneReminders) {
    events.push({
      id: `reminder-${r.id}`,
      title: r.title,
      startTime: r.reminderAt,
      endTime: new Date(r.reminderAt.getTime() + 30 * 60 * 1000),
      allDay: false,
      type: "reminder",
      ownerKeys: ["ak"],
      aceReminderId: r.id,
    });
  }
  events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const todayKey = formatYMD(now);

  // 5-day strip anchored to noon ET on each day so DST shifts can't
  // bump the label across a midnight boundary.
  const days: DayCell[] = [];
  for (let i = 0; i < 5; i += 1) {
    const anchor = new Date(
      weekStart.getTime() + i * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
    );
    const key = formatYMD(anchor);
    days.push({
      key,
      abbr: formatWeekdayShort(anchor),
      dayNum: formatDayNum(anchor),
      isToday: key === todayKey,
      events: [],
    });
  }

  const byKey = new Map<string, DayCell>();
  for (const d of days) byKey.set(d.key, d);
  for (const ev of events) {
    const cell = byKey.get(formatYMD(ev.startTime));
    if (!cell) continue;
    cell.events.push({
      id: ev.id,
      type: ev.type,
      title: ev.title,
      timeLabel: formatTimeLabel(ev.startTime),
      calendarColor: ev.calendarColor,
    });
  }

  const todayEvents = events.filter((e) => formatYMD(e.startTime) === todayKey);
  // Show EVERY upcoming event left today (no 2-cap) — the 5-day strip already
  // renders all events per day, and the today list must match it.
  const upNextToday: UpNextRow[] = todayEvents
    .filter((e) => e.startTime.getTime() > now.getTime())
    .map((e) => {
      const min = Math.max(
        0,
        Math.round((e.endTime.getTime() - e.startTime.getTime()) / 60_000),
      );
      return {
        id: e.id,
        timeLabel: formatTimeLabel(e.startTime),
        durationLabel: formatDurationLabel(min),
        type: e.type,
        title: e.title,
        meta: deriveRowMeta(e, selfPerson),
        calendarColor: e.calendarColor,
      };
    });

  const todayIdx = days.findIndex((d) => d.isToday);
  const laterEvents = events.filter((e) => {
    const idx = days.findIndex((d) => d.key === formatYMD(e.startTime));
    return todayIdx === -1 ? false : idx > todayIdx;
  });
  const laterRowsAll: LaterRow[] = laterEvents.map((e) => ({
    id: e.id,
    dayAbbr: formatWeekdayShort(e.startTime),
    timeLabel: formatTimeLabel(e.startTime),
    type: e.type,
    title: e.title,
    meta: deriveRowMeta(e, selfPerson),
    calendarColor: e.calendarColor,
  }));
  const laterRows = laterRowsAll.slice(0, 4);
  const laterOverflow = Math.max(0, laterRowsAll.length - laterRows.length);

  const countWeek = events.length;
  const countToday = todayEvents.length;
  const nextEvent = events.find((e) => e.startTime.getTime() > now.getTime());
  const nextInLabel = nextEvent ? formatNextIn(now, nextEvent.startTime) : null;

  // Current week leads with today's long date ("Monday, June 1"); other
  // weeks lead with the Mon-Fri range and hide the today-centric lists.
  const eyebrow = isCurrentWeek ? "THIS WEEK" : "WEEK OF";
  const heading = isCurrentWeek ? formatLongDay(now) : formatWeekRange(weekStart);

  return {
    days,
    upNextToday,
    laterRows,
    laterOverflow,
    events,
    eyebrow,
    heading,
    isCurrentWeek,
    countToday,
    countWeek,
    nextInLabel,
  };
}
