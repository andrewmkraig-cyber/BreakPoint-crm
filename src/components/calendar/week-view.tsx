"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
import {
  computeEventColumns,
  eventTypeMeta,
  fmtHour,
  hourToY,
  SLOT_HEIGHT,
} from "@/lib/calendar/utils";
import {
  decimalHour,
  getFullWeekDays,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

// Full 24-hour grid. The body scrolls inside a fixed-height container
// so the rest of the page never gets pushed off-screen.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Hour to land on when the view first mounts. 7 AM matches the old
// fixed 7-AM-to-8-PM window so the default still reads as "morning at
// the top" for users who have it muscle-memorized.
const DEFAULT_SCROLL_HOUR = 7;

type Props = {
  events: CalendarEvent[];
  selectedId: string | null;
  teamMode: boolean;
  teamMembers: CalendarTeamMember[];
  hiddenMembers: Set<string>;
  weekStart: Date;
  today: Date;
  now: Date;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (day: number, hour: number) => void;
  // Clicking the column header (e.g. "MON 25") jumps the main view
  // into day view focused on that date. Implemented at the parent so
  // the week view stays a dumb renderer.
  onDayHeaderClick: (date: Date) => void;
};

export function CalendarWeekView({
  events,
  selectedId,
  teamMode,
  teamMembers,
  hiddenMembers,
  weekStart,
  today,
  now,
  onEventClick,
  onSlotClick,
  onDayHeaderClick,
}: Props) {
  const weekDays = useMemo(() => getFullWeekDays(weekStart), [weekStart]);

  const eventsByDay = useMemo(() => {
    const out: CalendarEvent[][] = weekDays.map(() => []);
    for (const e of events) {
      if (
        e.ownerKeys.length > 0 &&
        e.ownerKeys.every((k) => hiddenMembers.has(k))
      )
        continue;
      const idx = weekDays.findIndex((d) => isSameDay(d.fullDate, e.startTime));
      if (idx < 0) continue;
      out[idx]?.push(e);
    }
    return out;
  }, [events, hiddenMembers, weekDays]);

  // Scrollable body that holds the full 24-hour grid. We scroll to
  // 7 AM on first mount so the default reading position matches the
  // old fixed-window behavior. Re-running on week change would yank
  // the recruiter back to morning every time they hit "next week" —
  // intentionally avoided.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = DEFAULT_SCROLL_HOUR * SLOT_HEIGHT;
    }
  }, []);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm"
      style={{ height: "calc(100vh - 13rem)", minHeight: 480 }}
    >
      {/* Day headers — stay pinned above the scrollable body so the
          recruiter always knows which column is which. */}
      <div
        className="grid shrink-0 border-b border-court-border"
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
      >
        <div />
        {weekDays.map((d) => {
          const isToday = isSameDay(d.fullDate, today);
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onDayHeaderClick(d.fullDate)}
              aria-label={`Open ${d.label} ${d.date} in day view`}
              className={cn(
                "block w-full cursor-pointer border-b border-court-border py-3.5 text-center transition hover:bg-court-brand-tint/30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-court-brand",
                isToday && "bg-court-brand-tint/40",
              )}
            >
              <div
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.16em]",
                  isToday ? "text-court-brand-dark" : "text-court-fg-muted",
                )}
              >
                {d.label}
              </div>
              <div className="mt-1 flex justify-center">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                    isToday ? "bg-court-brand text-white" : "text-court-fg",
                  )}
                >
                  {d.date}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Grid body — scrolls vertically so the calendar surface stays
          a fixed size on screen no matter how tall the 24-hour grid
          gets. */}
      <div ref={bodyRef} className="relative flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
        >
          {/* Time column */}
          <div>
            {HOURS.map((h) => (
              <div
                key={h}
                className="-translate-y-2 px-2 text-right text-[10.5px] font-semibold text-court-fg-muted"
                style={{ height: SLOT_HEIGHT }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {weekDays.map((d, i) => {
            const isToday = isSameDay(d.fullDate, today);
            const dayEvents = eventsByDay[i];
            const columns = computeEventColumns(dayEvents);
            return (
              <div
                key={d.key}
                className={cn(
                  "relative border-l border-court-border-soft",
                  isToday && "bg-court-brand-tint/30",
                )}
              >
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onSlotClick(i, h)}
                    className="group relative block w-full cursor-pointer border-t border-court-border-soft text-left transition hover:bg-court-brand-tint/30"
                    style={{ height: SLOT_HEIGHT }}
                  >
                    <span className="absolute right-1.5 top-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-court-brand-dark opacity-0 transition group-hover:opacity-100">
                      <Plus className="h-2.5 w-2.5" /> {fmtHour(h)}
                    </span>
                  </button>
                ))}
                {/* Events */}
                {dayEvents.map((ev) => {
                  const meta = eventTypeMeta(ev.type);
                  const start = decimalHour(ev.startTime);
                  const end = decimalHour(ev.endTime);
                  const top = hourToY(start);
                  const rawHeight = hourToY(end) - hourToY(start) - 2;
                  // Reminders are short (often 15 min); floor their
                  // height so the title stays readable instead of a sliver.
                  const height =
                    ev.type === "reminder" ? Math.max(rawHeight, 30) : rawHeight;
                  const owners = teamMode
                    ? ev.ownerKeys
                        .map((k) => teamMembers.find((m) => m.id === k))
                        .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    : [];
                  const isSelected = selectedId === ev.id;
                  // Google-Calendar-style pill: title leads, time
                  // shows as a secondary line only when there's
                  // vertical room. Owner avatars overlap on the
                  // top-right so they don't steal the title row in
                  // 30-minute events.
                  const showTime = height >= 32;
                  // Overlapping tiles (two interviews at the same time, a
                  // reminder sharing a slot) split the column into N
                  // side-by-side sub-columns so none covers another.
                  // Single tiles keep the full width via the class below.
                  // 4px gutter each side, 3px gap between columns.
                  const col = columns.get(ev.id) ?? { index: 0, count: 1 };
                  const multi = col.count > 1;
                  const laneStyle = multi
                    ? {
                        left: `calc(4px + (100% - 8px) / ${col.count} * ${col.index})`,
                        width: `calc((100% - 8px) / ${col.count} - 3px)`,
                      }
                    : null;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className={cn(
                        "absolute cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left leading-tight transition hover:-translate-y-px hover:shadow-sm",
                        !multi && "left-1 right-1",
                        meta.pillClass,
                        isSelected &&
                          "outline-2 outline-offset-2 outline outline-court-brand",
                      )}
                      style={{ top, height, ...(laneStyle ?? {}) }}
                    >
                      {owners.length > 0 && (
                        <span className="absolute right-1 top-1 flex -space-x-1">
                          {owners.map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-full border border-white text-[8px] font-bold text-white"
                              style={{ background: m.image ? undefined : m.color }}
                              title={m.name}
                            >
                              {m.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={m.image}
                                  alt={m.name}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                m.initials
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                      <div
                        className="truncate text-[12px] font-semibold"
                        style={
                          owners.length > 0
                            ? { paddingRight: owners.length * 12 + 4 }
                            : undefined
                        }
                      >
                        {ev.title}
                      </div>
                      {showTime && (
                        <div className="truncate text-[10.5px] opacity-80">
                          {fmtHour(start)}
                        </div>
                      )}
                    </button>
                  );
                })}
                {/* Now line on today */}
                {isToday && <NowLine now={now} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  const y = hourToY(decimalHour(now));
  return (
    <div
      className="pointer-events-none absolute -left-1.5 right-0 z-[4] h-0.5 bg-rose-600"
      style={{ top: y }}
    >
      <span
        className="absolute -left-1.5 -top-1 inline-block h-2.5 w-2.5 rounded-full bg-rose-600 ring-[3px] ring-rose-600/20"
      />
    </div>
  );
}
