"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
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
  teamMembers: CalendarTeamMember[];
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
  onEventClick: (event: CalendarEvent) => void;
  // Empty-cell click target — opens the drawer in create mode with
  // the cell's date pre-filled.
  onDayClick: (date: Date) => void;
};

type MonthCell = {
  date: Date;
  outsideMonth: boolean;
  isToday: boolean;
  inCurrentWeek: boolean;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MAX_VISIBLE_EVENTS = 3;

export function CalendarMonthView({
  events,
  hiddenMembers,
  teamMembers,
  monthStart,
  currentWeekStart,
  today,
  onEventClick,
  onDayClick,
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

  const selfKey = teamMembers.find((m) => m.self)?.id ?? null;

  const eventsByDateKey = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (
        e.ownerKeys.length > 0 &&
        e.ownerKeys.every((k) => hiddenMembers.has(k))
      )
        continue;
      const key = dateKey(e.startTime);
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    // All-day events lead, then timed events ascend by start. Same
    // order the chip stack and the "+N more" popover render in.
    map.forEach((list) => {
      list.sort((a, b) => {
        if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
        return a.startTime.getTime() - b.startTime.getTime();
      });
    });
    return map;
  }, [events, hiddenMembers]);

  // Single open popover at a time, keyed by the cell's date. Click on
  // a different "+N more" pill moves the popover; click anywhere else
  // dismisses via the document-level mousedown listener.
  const [popoverDay, setPopoverDay] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!popoverDay) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        setPopoverDay(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [popoverDay]);

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
            const cellKey = dateKey(cell.date);
            const dayEvents = eventsByDateKey.get(cellKey) ?? [];
            const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
            const overflow = dayEvents.length - visible.length;
            return (
              <div
                key={`${wi}-${di}`}
                onClick={() => onDayClick(cell.date)}
                className={cn(
                  "relative min-w-0 cursor-pointer border-court-border-soft p-2 text-left transition",
                  di < 6 && "border-r",
                  wi < 5 && "border-b",
                  // Current-week row gets a subtle full-row tint —
                  // applied per cell since every cell in the row
                  // shares inCurrentWeek.
                  cell.inCurrentWeek
                    ? "bg-court-surface-subtle hover:bg-court-surface-subtle/80"
                    : "hover:bg-court-surface-subtle",
                  cell.outsideMonth && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums",
                      cell.isToday
                        ? "border-2 border-court-brand font-bold text-court-brand-dark"
                        : "font-semibold text-court-fg",
                    )}
                  >
                    {cell.date.getDate()}
                  </span>
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopoverDay((d) => (d === cellKey ? null : cellKey));
                      }}
                      className="rounded px-1 text-[10px] font-semibold text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  {visible.map((ev) => (
                    <EventChip
                      key={ev.id}
                      ev={ev}
                      selfKey={selfKey}
                      onClick={onEventClick}
                    />
                  ))}
                </div>
                {popoverDay === cellKey && (
                  <div
                    ref={popoverRef}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 top-9 z-20 max-h-[280px] w-[220px] overflow-auto rounded-xl border border-court-border bg-court-surface p-2 shadow-lg"
                  >
                    <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-court-fg-muted">
                      {cell.date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.map((ev) => (
                        <EventChip
                          key={ev.id}
                          ev={ev}
                          selfKey={selfKey}
                          onClick={(e) => {
                            setPopoverDay(null);
                            onEventClick(e);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

function EventChip({
  ev,
  selfKey,
  onClick,
}: {
  ev: CalendarEvent;
  selfKey: string | null;
  onClick: (ev: CalendarEvent) => void;
}) {
  if (ev.allDay) {
    // Owned = self is an owner (or no owners at all, which we treat
    // as a personal event). Team-only events render in the neutral
    // surface-subtle so the recruiter can scan the row for their own
    // commitments at a glance.
    const isOwned =
      selfKey == null ||
      ev.ownerKeys.length === 0 ||
      ev.ownerKeys.includes(selfKey);
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          onClick(ev);
        }}
        className={cn(
          "w-full cursor-pointer truncate rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
          isOwned
            ? "border-court-brand/40 bg-court-brand-tint text-court-brand-dark"
            : "border-court-border bg-court-surface-subtle text-court-fg",
        )}
      >
        {ev.title}
      </div>
    );
  }
  const meta = eventTypeMeta(ev.type);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick(ev);
      }}
      className={cn(
        "cursor-pointer truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight",
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
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
