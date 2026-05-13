import { ArrowUpRight, CalendarClock } from "lucide-react";
import Link from "next/link";

import { ownerKeyForCalendar } from "@/lib/calendar/owner-key";
import { eventTypeMeta } from "@/lib/calendar/utils";
import { prisma } from "@/lib/prisma";
import { getEasternWeekBounds } from "@/lib/week";
import { cn } from "@/lib/utils";

// Court-mode "This Week" widget on the Clubhouse tab. Renders a
// Mon-Fri ET overview of CalendarEvent rows with a 5-day strip plus
// "Up next today" and "Later this week" sections. Everything is
// pre-formatted server-side with explicit en-US + America/New_York
// so SSR and hydration agree byte-for-byte.

const ZONE = "America/New_York";

type EventType = "interview" | "client" | "reminder" | "other";

// Same derivation rule the Calendar page uses — the schema does not
// carry an event type, so we infer from title + calendar name. Kept
// inline here rather than abstracted so the dashboard widget stays
// self-contained.
function deriveType(title: string, calendarName: string): EventType {
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

const PILL_CLASS: Record<EventType, string> = {
  interview:
    "bg-court-brand-tint text-court-brand-dark dark:bg-court-brand-tint dark:text-court-brand-dark",
  client:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  reminder:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  other: "bg-court-surface-subtle text-court-fg-muted",
};

const PILL_LABEL: Record<EventType, string> = {
  interview: "Interview",
  client: "Client Call",
  reminder: "Reminder",
  other: "Event",
};

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
// never renders as "Next in 2742 min". Under an hour stays in
// minutes; under a day rounds to hours; otherwise rounds to days.
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

type DayCellEvent = {
  id: string;
  type: EventType;
  title: string;
  timeLabel: string;
};

type DayCell = {
  key: string;
  abbr: string;
  dayNum: string;
  isToday: boolean;
  events: DayCellEvent[];
};

type UpNextRow = {
  id: string;
  timeLabel: string;
  durationMin: number;
  type: EventType;
  title: string;
};

type LaterRow = {
  id: string;
  dayAbbr: string;
  timeLabel: string;
  title: string;
};

type UpcomingInterviewWidgetRow = {
  id: string;
  dayAbbr: string;
  timeLabel: string;
  title: string;
};

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
  // resolves to anything other than "ak". Austin's events stay on the
  // /calendar page (team view) but never appear on this dashboard tile.
  const rows = rowsAll.filter(
    (r) =>
      ownerKeyForCalendar(
        { calendarId: r.calendarId, calendarName: r.calendarName },
        selfPerson,
      ) === "ak",
  );

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

  type EventRow = {
    id: string;
    type: EventType;
    title: string;
    startTime: Date;
    endTime: Date;
    timeLabel: string;
    dayKey: string;
  };
  const events: EventRow[] = rows.map((r) => ({
    id: r.id,
    type: deriveType(r.title, r.calendarName),
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    timeLabel: formatTimeLabel(r.startTime),
    dayKey: formatYMD(r.startTime),
  }));

  // Distribute event chips into their day columns. The query is
  // already sorted by startTime ascending so chips stack chronologically.
  const byKey = new Map<string, DayCell>();
  for (const d of days) byKey.set(d.key, d);
  for (const ev of events) {
    const cell = byKey.get(ev.dayKey);
    if (cell) {
      cell.events.push({
        id: ev.id,
        type: ev.type,
        title: ev.title,
        timeLabel: ev.timeLabel,
      });
    }
  }

  const todayEvents = events.filter((e) => e.dayKey === todayKey);
  const upNextToday: UpNextRow[] = todayEvents
    .filter((e) => e.startTime.getTime() > now.getTime())
    .slice(0, 2)
    .map((e) => ({
      id: e.id,
      timeLabel: e.timeLabel,
      durationMin: Math.max(
        0,
        Math.round((e.endTime.getTime() - e.startTime.getTime()) / 60_000),
      ),
      type: e.type,
      title: e.title,
    }));

  const todayIdx = days.findIndex((d) => d.isToday);
  const laterEvents = events.filter((e) => {
    const idx = days.findIndex((d) => d.key === e.dayKey);
    return todayIdx === -1 ? false : idx > todayIdx;
  });
  const laterRowsAll: LaterRow[] = laterEvents.map((e) => ({
    id: e.id,
    dayAbbr: formatWeekdayShort(e.startTime),
    timeLabel: e.timeLabel,
    title: e.title,
  }));
  const laterRows = laterRowsAll.slice(0, 4);
  const laterOverflow = Math.max(0, laterRowsAll.length - laterRows.length);

  // Upcoming Interviews subsection: next 3 calendar events whose
  // derived type is "interview" and whose start is in the future.
  const upcomingInterviews: UpcomingInterviewWidgetRow[] = events
    .filter((e) => e.type === "interview" && e.startTime.getTime() > now.getTime())
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      dayAbbr: formatWeekdayShort(e.startTime),
      timeLabel: e.timeLabel,
      title: e.title,
    }));

  // Header counters
  const countWeek = events.length;
  const countToday = todayEvents.length;
  const nextEvent = events.find((e) => e.startTime.getTime() > now.getTime());
  const nextInLabel = nextEvent ? formatNextIn(now, nextEvent.startTime) : null;

  const todayHeading = formatLongDay(now);

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_12px_32px_rgba(0,0,0,.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
            THIS WEEK
          </div>
          <h2
            className="mt-1 font-semibold tracking-[-0.035em] text-court-fg"
            style={{ fontSize: "18px", lineHeight: 1.15 }}
          >
            {todayHeading}
          </h2>
          <p className="mt-1 text-[12px] text-court-fg-muted">
            {countToday} today · {countWeek} this week
            {nextInLabel != null && <> · Next in {nextInLabel}</>}
          </p>
        </div>
        <Link
          href="/calendar"
          className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          Open Calendar
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 5-day strip — condensed weekly grid with chip-style events.
          Mirrors the calendar week view's pill palette so the dashboard
          and the full calendar read as one product. */}
      <div className="mt-4 grid grid-cols-5">
        {days.map((day, i) => {
          const visible = day.events.slice(0, day.events.length > 3 ? 2 : 3);
          const overflow = day.events.length - visible.length;
          return (
            <div
              key={day.key}
              className={cn(
                "min-w-0 px-1.5 py-1.5",
                i > 0 && "border-l border-court-border-soft",
                day.isToday && "bg-court-brand-tint/40",
              )}
            >
              <div
                className={cn(
                  "flex items-baseline justify-between px-1",
                  day.isToday && "text-court-brand-dark",
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-extrabold uppercase tracking-[0.12em]",
                    day.isToday ? "text-court-brand-dark" : "text-court-fg-muted",
                  )}
                >
                  {day.abbr}
                </span>
                <span
                  className={cn(
                    "font-serif text-sm font-bold tabular-nums",
                    day.isToday ? "text-court-brand-dark" : "text-court-fg",
                  )}
                >
                  {day.dayNum}
                </span>
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {visible.length === 0 ? (
                  <span className="px-1 text-[10px] font-medium text-court-fg-dim">
                    —
                  </span>
                ) : (
                  visible.map((e) => {
                    const meta = eventTypeMeta(e.type);
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "min-w-0 truncate rounded-md border px-1.5 py-0.5 leading-tight",
                          meta.pillClass,
                        )}
                        title={`${e.timeLabel} · ${e.title}`}
                      >
                        <div className="truncate text-[10.5px] font-semibold">
                          {e.title}
                        </div>
                        <div className="truncate text-[9.5px] opacity-80">
                          {e.timeLabel}
                        </div>
                      </div>
                    );
                  })
                )}
                {overflow > 0 && (
                  <div className="truncate rounded-md bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold text-court-fg-muted">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Up next today */}
      <div className="mt-5">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Up next today
        </div>
        {upNextToday.length === 0 ? (
          <div className="mt-2 text-[13px] text-court-fg-dim">
            Nothing else today
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border-soft">
            {upNextToday.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 py-2 first:pt-1 last:pb-1"
              >
                <span className="w-[72px] shrink-0 text-[13px] font-semibold tabular-nums text-court-fg">
                  {r.timeLabel}
                </span>
                <span className="w-10 shrink-0 text-[11px] font-medium text-court-fg-muted">
                  {r.durationMin}m
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                    PILL_CLASS[r.type],
                  )}
                >
                  {PILL_LABEL[r.type]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-court-fg">
                  {r.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Later this week */}
      <div className="mt-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Later this week
        </div>
        {laterRows.length === 0 ? (
          <div className="mt-2 text-[13px] text-court-fg-dim">
            Nothing else scheduled
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border-soft rounded-xl bg-court-surface-subtle px-4 py-3">
            {laterRows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="w-8 shrink-0 text-xs text-court-fg-muted">
                  {r.dayAbbr}
                </span>
                <span className="w-20 shrink-0 text-[13px] font-medium tabular-nums text-court-fg">
                  {r.timeLabel}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-court-fg">
                  {r.title}
                </span>
              </li>
            ))}
          </ul>
        )}
        {laterOverflow > 0 && (
          <div className="mt-2 text-[11px] font-semibold text-court-fg-muted">
            + {laterOverflow} more this week
          </div>
        )}
      </div>

      {/* Upcoming interviews — merged in from the former standalone
          UpcomingInterviews card. Sourced from the same week query
          above, filtered to derived type "interview" and future. */}
      <div className="mt-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-3 w-3 text-court-fg-muted" />
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
            Upcoming interviews
          </div>
        </div>
        {upcomingInterviews.length === 0 ? (
          <div className="mt-2 text-[13px] text-court-fg-dim">
            No interviews this week
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border-soft">
            {upcomingInterviews.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 py-2 first:pt-1 last:pb-1"
              >
                <span className="w-10 shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-court-fg-muted">
                  {r.dayAbbr}
                </span>
                <span className="w-[72px] shrink-0 text-[13px] font-semibold tabular-nums text-court-fg">
                  {r.timeLabel}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-court-fg">
                  {r.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
