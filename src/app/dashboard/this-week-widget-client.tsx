"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

import { fetchWeekData } from "./this-week-actions";

// All formatting (timeLabel, weekdayShort, etc.) happens server-side
// and is passed down as plain strings so SSR + hydration agree
// byte-for-byte. The client component owns drawer state and click
// handlers - every chip and row dispatches openEvent(id) which looks
// up the matching CalendarEvent and opens the same drawer used on
// /calendar in edit mode.

export type DayCellEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  timeLabel: string;
};

export type DayCell = {
  key: string;
  abbr: string;
  dayNum: string;
  isToday: boolean;
  events: DayCellEvent[];
};

export type UpNextRow = {
  id: string;
  timeLabel: string;
  durationLabel: string;
  type: CalendarEventType;
  title: string;
  meta: string;
};

export type LaterRow = {
  id: string;
  dayAbbr: string;
  timeLabel: string;
  type: CalendarEventType;
  title: string;
  meta: string;
};

// Vertical strip down the left edge of each schedule row. Blue for
// interviews, sage for client calls (Andrew's flagship outbound),
// yellow for candidate calls, amber for reminders, neutral fg-dim
// for anything else.
const STRIP_BG: Record<CalendarEventType, string> = {
  interview: "bg-blue-700",
  client: "bg-court-brand",
  candidate: "bg-yellow-600",
  reminder: "bg-amber-600",
  other: "bg-court-fg-dim",
};

const PILL_CLASS: Record<CalendarEventType, string> = {
  interview:
    "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  client:
    "bg-court-brand-tint text-court-brand-dark border-court-brand/35",
  candidate:
    "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
  reminder:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  other: "bg-court-surface-subtle text-court-fg-muted border-court-border",
};

const PILL_LABEL: Record<CalendarEventType, string> = {
  interview: "Interview",
  client: "Client",
  candidate: "Candidate",
  reminder: "Reminder",
  other: "Event",
};

// One week's worth of pre-formatted widget data. getWeekData (server)
// produces it for the initial render and for every ‹ › paging request.
// isCurrentWeek gates the today-centric heading + lists: offset 0 leads
// with today's date and shows "Up next today" / "Later this week"; other
// weeks lead with the Mon-Fri range and hide both lists.
export type WeekViewData = {
  days: DayCell[];
  upNextToday: UpNextRow[];
  laterRows: LaterRow[];
  laterOverflow: number;
  events: CalendarEvent[];
  eyebrow: string;
  heading: string;
  isCurrentWeek: boolean;
  countToday: number;
  countWeek: number;
  nextInLabel: string | null;
};

type Props = {
  initial: WeekViewData;
};

export function ThisWeekWidgetClient({ initial }: Props) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  // weekOffset is the only paging state the client owns; each change pulls
  // that week's data from the server action and swaps it in. useTransition
  // keeps the current week on screen (dimmed) until the next week lands.
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<WeekViewData>(initial);
  const [pending, startTransition] = useTransition();

  const {
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
  } = data;

  const goToWeek = (next: number) => {
    startTransition(async () => {
      const d = await fetchWeekData(next);
      setData(d);
      setOffset(next);
    });
  };

  const eventsById = useMemo(() => {
    const m = new Map<string, CalendarEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const openEvent = (id: string) => {
    const ev = eventsById.get(id);
    if (!ev) return;
    // Reminders aren't real Google events; send the user to the calendar
    // where the reminders panel can edit them.
    if (ev.aceReminderId) {
      router.push("/calendar");
      return;
    }
    setSelected(ev);
    setDrawerOpen(true);
  };

  return (
    <section className="flex h-full flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
              {eyebrow}
            </div>
            {/* ‹ › page the Mon-Fri window one week at a time. Muted
                icon-button treatment; disabled while a fetch is in
                flight so rapid clicks can't race. "This week" resets to
                offset 0 and only shows when paged away. */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => goToWeek(offset - 1)}
                disabled={pending}
                aria-label="Previous week"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg focus:outline-none focus:ring-1 focus:ring-court-brand/40 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => goToWeek(offset + 1)}
                disabled={pending}
                aria-label="Next week"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg focus:outline-none focus:ring-1 focus:ring-court-brand/40 disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {!isCurrentWeek && (
                <button
                  type="button"
                  onClick={() => goToWeek(0)}
                  disabled={pending}
                  className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-court-brand transition hover:bg-court-surface-subtle disabled:opacity-50"
                >
                  This week
                </button>
              )}
            </div>
          </div>
          <h2
            className="mt-1 font-semibold tracking-[-0.035em] text-court-fg"
            style={{ fontSize: "18px", lineHeight: 1.15 }}
          >
            {heading}
          </h2>
          <p className="mt-1 text-[12px] text-court-fg-muted">
            {isCurrentWeek ? (
              <>
                {countToday} today · {countWeek} this week
                {nextInLabel != null && <> · Next in {nextInLabel}</>}
              </>
            ) : (
              <>
                {countWeek} {countWeek === 1 ? "event" : "events"} this week
              </>
            )}
          </p>
        </div>
        <Link
          href="/calendar"
          className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-[12px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          Open Calendar
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Body dims while a week swap is in flight; the header + arrows
          stay live so paging never feels locked. */}
      <div
        aria-busy={pending}
        className={cn("transition-opacity", pending && "pointer-events-none opacity-50")}
      >
      {/* 5-day strip - each day is its own bordered tile, events stack
          INSIDE the tile so nothing clips at the Friday edge or smushes
          against the Thursday divider. Today gets a sage-tinted tile
          plus a brand-colored day number so the eye lands on it first. */}
      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {days.map((day) => {
          // Show EVERY event for the day (no cap). Each event is a single
          // compact line, so the cell grows to fit them all instead of
          // truncating at a "+N more" tail.
          const visible = day.events;
          return (
            <div
              key={day.key}
              className={cn(
                "flex min-h-[128px] min-w-0 flex-col rounded-xl border px-2 py-2",
                day.isToday
                  ? "border-court-brand/45 bg-court-brand-tint/40"
                  : "border-court-border bg-court-surface-subtle",
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    "text-[10px] font-extrabold uppercase tracking-[0.12em]",
                    day.isToday
                      ? "text-court-brand-dark"
                      : "text-court-fg-muted",
                  )}
                >
                  {day.abbr}
                </span>
                <span
                  className={cn(
                    "font-serif text-base font-bold tabular-nums",
                    day.isToday ? "text-court-brand-dark" : "text-court-fg",
                  )}
                >
                  {day.dayNum}
                </span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-1 flex-col gap-[3px]">
                {visible.length === 0 ? (
                  <span className="px-0.5 py-1 text-[10.5px] italic text-court-fg-dim">
                    No events
                  </span>
                ) : (
                  visible.map((e) => {
                    const meta = eventTypeMeta(e.type);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => openEvent(e.id)}
                        title={`${e.timeLabel} · ${e.title}`}
                        className={cn(
                          // Single compact line: time + title inline, both
                          // truncated, so many events fit in the day cell.
                          "flex min-w-0 items-baseline gap-1 rounded-md border px-1.5 py-[1px] text-left leading-tight transition hover:brightness-95 focus:outline-none focus:ring-1 focus:ring-court-brand/40",
                          meta.pillClass,
                        )}
                      >
                        <span className="shrink-0 text-[9px] font-semibold tabular-nums opacity-70">
                          {e.timeLabel}
                        </span>
                        <span className="truncate text-[10px] font-bold">
                          {e.title}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {day.isToday && (
                <div className="mt-auto pt-1 text-[10px] font-semibold text-court-brand-dark">
                  Today
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isCurrentWeek && (
        <>
      {/* Up next today - rich row: time + duration block, color strip,
          name + meta, type chip. Same layout pattern as Later this week
          so the two sections read as one continuous schedule. */}
      <div className="mt-5">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
          Up next today
        </div>
        {upNextToday.length === 0 ? (
          <div className="mt-2 py-3 text-[13px] text-court-fg-muted">
            Nothing else today.
          </div>
        ) : (
          <ul className="mt-2 flex flex-col">
            {upNextToday.map((r, i) => (
              <li
                key={r.id}
                className={cn(
                  i < upNextToday.length - 1 && "border-b border-court-border-soft",
                )}
              >
                <ScheduleRow
                  topLabel={r.timeLabel}
                  subLabel={r.durationLabel}
                  name={r.title}
                  meta={r.meta}
                  type={r.type}
                  onClick={() => openEvent(r.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Later this week - same rich-row component, time block reads
          dayAbbr (top) + clock label (bottom) so the eye can scan by
          weekday in this section. */}
      <div className="mt-4">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
          Later this week
        </div>
        {laterRows.length === 0 ? (
          <div className="mt-2 py-3 text-[13px] text-court-fg-muted">
            Nothing else scheduled.
          </div>
        ) : (
          <ul className="mt-2 flex flex-col">
            {laterRows.map((r, i) => (
              <li
                key={r.id}
                className={cn(
                  i < laterRows.length - 1 && "border-b border-court-border-soft",
                )}
              >
                <ScheduleRow
                  topLabel={r.dayAbbr}
                  subLabel={r.timeLabel}
                  name={r.title}
                  meta={r.meta}
                  type={r.type}
                  onClick={() => openEvent(r.id)}
                />
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
        </>
      )}
      </div>

      <CalendarEventDrawer
        open={drawerOpen}
        mode="edit"
        event={selected}
        prefill={null}
        onClose={() => setDrawerOpen(false)}
      />
    </section>
  );
}

function ScheduleRow({
  topLabel,
  subLabel,
  name,
  meta,
  type,
  onClick,
}: {
  topLabel: string;
  subLabel: string;
  name: string;
  meta: string;
  type: CalendarEventType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-court-surface-subtle/60 focus:outline-none focus:ring-1 focus:ring-court-brand/40"
    >
      <div className="w-[72px] shrink-0">
        <div className="text-[13px] font-bold tabular-nums text-court-fg">
          {topLabel}
        </div>
        {subLabel ? (
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-court-fg-muted">
            {subLabel}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "my-1 w-[3px] self-stretch shrink-0 rounded-[2px]",
          STRIP_BG[type],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-court-fg">
          {name}
        </div>
        {meta ? (
          <div className="mt-0.5 truncate text-[11.5px] text-court-fg-muted">
            {meta}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
          PILL_CLASS[type],
        )}
      >
        {PILL_LABEL[type]}
      </span>
    </button>
  );
}
