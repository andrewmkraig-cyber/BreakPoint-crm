"use client";

import { useMemo } from "react";

import type { CalendarEvent } from "@/lib/calendar/types";
import { eventTypeMeta, fmtTime } from "@/lib/calendar/utils";
import {
  addDays,
  getMondayOfWeek,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

type Props = {
  events: CalendarEvent[];
  hiddenMembers: Set<string>;
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
  onEventClick: (event: CalendarEvent) => void;
  onWeekClick: (weekStart: Date) => void;
};

type MonthCell = {
  date: Date;
  outsideMonth: boolean;
  isToday: boolean;
  inCurrentWeek: boolean;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function CalendarMonthView({
  events,
  hiddenMembers,
  monthStart,
  currentWeekStart,
  today,
  onEventClick,
  onWeekClick,
}: Props) {
  // Mon-first 6×7 grid that always starts at the Monday on or before
  // the 1st of the displayed month, so the visible month sits inside.
  const weeks: MonthCell[][] = useMemo(() => {
    const gridStart = getMondayOfWeek(monthStart);
    const rows: MonthCell[][] = [];
    for (let w = 0; w < 6; w += 1) {
      const row: MonthCell[] = [];
      for (let d = 0; d < 7; d += 1) {
        const cellDate = addDays(gridStart, w * 7 + d);
        row.push({
          date: cellDate,
          outsideMonth: cellDate.getMonth() !== monthStart.getMonth(),
          isToday: isSameDay(cellDate, today),
          inCurrentWeek: isSameDay(
            getMondayOfWeek(cellDate),
            currentWeekStart,
          ),
        });
      }
      rows.push(row);
    }
    return rows;
  }, [monthStart, currentWeekStart, today]);

  const eventsByDateKey = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.ownerId && hiddenMembers.has(e.ownerId)) continue;
      const key = dateKey(e.startTime);
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events, hiddenMembers]);

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="grid grid-cols-7 border-b border-court-border">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="py-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted"
          >
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7"
        style={{ gridTemplateRows: "repeat(6, minmax(116px, 1fr))" }}
      >
        {weeks.flatMap((week, wi) =>
          week.map((cell, di) => {
            const dayEvents = eventsByDateKey.get(dateKey(cell.date)) ?? [];
            return (
              <button
                key={`${wi}-${di}`}
                type="button"
                onClick={() => onWeekClick(getMondayOfWeek(cell.date))}
                className={cn(
                  "border-court-border-soft p-2 text-left transition",
                  di < 6 && "border-r",
                  wi < 5 && "border-b",
                  cell.inCurrentWeek
                    ? "bg-court-brand-tint/30 hover:bg-court-brand-tint/40"
                    : "hover:bg-court-surface-subtle",
                  cell.outsideMonth && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                      cell.isToday ? "bg-court-brand text-white" : "text-court-fg",
                    )}
                  >
                    {cell.date.getDate()}
                  </span>
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] font-semibold text-court-fg-muted">
                      +{dayEvents.length - 3}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => {
                    const meta = eventTypeMeta(ev.type);
                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev);
                        }}
                        className={cn(
                          "cursor-pointer rounded border px-1.5 py-0.5 text-[11px] leading-tight",
                          meta.pillClass,
                        )}
                      >
                        <div className="truncate font-semibold">
                          <span className="font-medium opacity-70">
                            {fmtTime(ev.startTime)} ·{" "}
                          </span>
                          {ev.title}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
