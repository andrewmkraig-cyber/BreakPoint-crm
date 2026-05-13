import { ownerKeyForCalendar } from "@/lib/calendar/owner-key";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { prisma } from "@/lib/prisma";
import { getEasternWeekBounds } from "@/lib/week";

import {
  ThisWeekWidgetClient,
  type DayCell,
  type LaterRow,
  type UpNextRow,
} from "./this-week-widget-client";

// Court-mode "This Week" widget on the Clubhouse tab. Server fetches +
// pre-formats every label so SSR and hydration agree byte-for-byte;
// the client component owns the drawer state so chips and rows in the
// strip / lists open the same /calendar event drawer when clicked.

const ZONE = "America/New_York";

type AttendeeJson = { displayName?: string; email?: string };

// Same derivation rule the Calendar page uses — the schema does not
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

function formatYMD(d: Date): string {
  // YYYY-MM-DD in ET — used to bucket events by day. formatToParts
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

export async function ThisWeekWidget({
  orgId,
  selfPerson,
}: {
  orgId: string;
  selfPerson: { name: string | null; email: string | null };
}) {
  const now = new Date();
  const { start: weekStart } = getEasternWeekBounds(now);
  // Saturday 00:00 ET — exclusive end of the Mon-Fri window.
  const weekEnd = new Date(weekStart.getTime() + 5 * 24 * 60 * 60 * 1000);

  const rowsAll = await prisma.calendarEvent.findMany({
    where: {
      organizationId: orgId,
      status: { not: "CANCELLED" },
      startTime: { gte: weekStart, lt: weekEnd },
    },
    orderBy: { startTime: "asc" },
  });

  // Clubhouse widget is Andrew's view — strip any row whose owner key
  // resolves to anything other than "ak". Austin's events stay on
  // /calendar (team view) but never appear on this dashboard tile.
  const rows = rowsAll.filter(
    (r) =>
      ownerKeyForCalendar(
        { calendarId: r.calendarId, calendarName: r.calendarName },
        selfPerson,
      ) === "ak",
  );

  // Full CalendarEvent objects in the same shape the /calendar page
  // produces — passed through to the drawer when a chip or row is
  // clicked. Andrew-only here, so no need to dedupe googleEventId
  // across calendars.
  const events: CalendarEvent[] = rows.map((row) => {
    const attendees = (row.attendees as AttendeeJson[] | null) ?? null;
    const guests = attendees
      ? attendees
          .map((a) => (a.displayName ?? a.email ?? "").trim())
          .filter((s) => s.length > 0)
      : undefined;
    return {
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: row.allDay,
      type: deriveType(row.title, row.calendarName),
      meta: row.description ?? undefined,
      guests,
      location: row.location ?? undefined,
      ownerKeys: ["ak"],
      jobId: row.jobId ?? undefined,
      candidateId: row.candidateId ?? undefined,
      clientId: row.clientId ?? undefined,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor ?? undefined,
      meetLink: row.meetLink ?? undefined,
      htmlLink: row.htmlLink ?? undefined,
    };
  });

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
    });
  }

  const todayEvents = events.filter((e) => formatYMD(e.startTime) === todayKey);
  const upNextToday: UpNextRow[] = todayEvents
    .filter((e) => e.startTime.getTime() > now.getTime())
    .slice(0, 2)
    .map((e) => ({
      id: e.id,
      timeLabel: formatTimeLabel(e.startTime),
      durationMin: Math.max(
        0,
        Math.round((e.endTime.getTime() - e.startTime.getTime()) / 60_000),
      ),
      type: e.type,
      title: e.title,
    }));

  const todayIdx = days.findIndex((d) => d.isToday);
  const laterEvents = events.filter((e) => {
    const idx = days.findIndex((d) => d.key === formatYMD(e.startTime));
    return todayIdx === -1 ? false : idx > todayIdx;
  });
  const laterRowsAll: LaterRow[] = laterEvents.map((e) => ({
    id: e.id,
    dayAbbr: formatWeekdayShort(e.startTime),
    timeLabel: formatTimeLabel(e.startTime),
    title: e.title,
  }));
  const laterRows = laterRowsAll.slice(0, 4);
  const laterOverflow = Math.max(0, laterRowsAll.length - laterRows.length);

  const countWeek = events.length;
  const countToday = todayEvents.length;
  const nextEvent = events.find((e) => e.startTime.getTime() > now.getTime());
  const nextInLabel = nextEvent ? formatNextIn(now, nextEvent.startTime) : null;

  const todayHeading = formatLongDay(now);

  return (
    <ThisWeekWidgetClient
      days={days}
      upNextToday={upNextToday}
      laterRows={laterRows}
      laterOverflow={laterOverflow}
      events={events}
      todayHeading={todayHeading}
      countToday={countToday}
      countWeek={countWeek}
      nextInLabel={nextInLabel}
    />
  );
}
