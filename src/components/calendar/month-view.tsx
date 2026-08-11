"use client";

import { useMemo } from "react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
import { Button } from "@/components/ui/button";
import { googleEventColorStyle } from "@/lib/calendar/google-colors";
import { eventTypeMeta, fmtTime, packLanes } from "@/lib/calendar/utils";
import {
  addDays,
  allDayFirstDay,
  allDayLastDay,
  dayOffsetFrom,
  getMondayOfWeek,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

const clampIdx = (n: number) => Math.max(0, Math.min(6, n));

// One drawn segment of an all-day block inside a single week row. A
// multi-day event produces one slot per week it touches; the lane keeps it
// on the same stacked row across the cells it covers so it reads as one bar.
type AllDaySlot = {
  ev: CalendarEvent;
  startIdx: number; // first covered column in this week, clamped 0..6
  endIdx: number; // last covered column in this week, clamped 0..6
  lane: number;
  startsBefore: boolean; // span began in an earlier week
  endsAfter: boolean; // span continues into a later week
};

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
  // Focus target for the day-number pill and "+N more" overflow.
  // Unlike the empty cell, this should expand into the full day view.
  onDayFocus: (date: Date) => void;
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
  onDayFocus,
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
    // order the chip stack and the day-detail view use.
    map.forEach((list) => {
      list.sort((a, b) => {
        if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
        return a.startTime.getTime() - b.startTime.getTime();
      });
    });
    return map;
  }, [events, hiddenMembers]);

  // Multi-day all-day events are drawn as continuous bars in a band at the
  // top of each cell, NOT in the per-day chip stack. We lay them out one
  // week row at a time: clamp each spanning event to the week's columns,
  // then lane-pack so a bar keeps the same stacked row across every cell it
  // covers. `laneCount` per week tells each cell how many band rows to draw
  // (occupied or empty) so neighbours stay vertically aligned.
  const allDayBandByWeek = useMemo(() => {
    const allDay = events.filter(
      (e) =>
        e.allDay &&
        !(
          e.ownerKeys.length > 0 &&
          e.ownerKeys.every((k) => hiddenMembers.has(k))
        ),
    );
    return weeks.map((week) => {
      const weekStart = week[0].date;
      const weekEnd = week[6].date;
      const slots: AllDaySlot[] = [];
      for (const ev of allDay) {
        const first = allDayFirstDay(ev.startTime);
        const last = allDayLastDay(ev.endTime);
        // Skip events that don't touch this week at all.
        if (last.getTime() < weekStart.getTime()) continue;
        if (first.getTime() > weekEnd.getTime()) continue;
        const rawStart = dayOffsetFrom(weekStart, first);
        const rawEnd = dayOffsetFrom(weekStart, last);
        slots.push({
          ev,
          startIdx: clampIdx(rawStart),
          endIdx: clampIdx(rawEnd),
          lane: 0,
          startsBefore: rawStart < 0,
          endsAfter: rawEnd > 6,
        });
      }
      const lanes = packLanes(slots);
      slots.forEach((s, i) => (s.lane = lanes[i]));
      const laneCount = lanes.length ? Math.max(...lanes) + 1 : 0;
      return { slots, laneCount };
    });
  }, [events, hiddenMembers, weeks]);

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
            // All-day events render in the band above; only timed events
            // fill the per-day chip stack + "+N more" overflow.
            const timed = dayEvents.filter((e) => !e.allDay);
            const visible = timed.slice(0, MAX_VISIBLE_EVENTS);
            const overflow = timed.length - visible.length;
            const band = allDayBandByWeek[wi];
            return (
              <div
                key={`${wi}-${di}`}
                onClick={() => onDayClick(cell.date)}
                className={cn(
                  "relative flex min-w-0 cursor-pointer flex-col border-court-border-soft p-2 text-left transition",
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayFocus(cell.date);
                    }}
                    aria-label={`Open ${cell.date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}`}
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums transition hover:bg-court-brand-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-court-brand",
                      cell.isToday
                        ? "border-2 border-court-brand font-bold text-court-brand-dark"
                        : "border-0 font-semibold text-court-fg",
                      "bg-transparent py-0 shadow-none",
                    )}
                  >
                    {cell.date.getDate()}
                  </Button>
                </div>
                {/* All-day band: one fixed-height row per lane so multi-day
                    bars line up across the week. Each cell draws either the
                    bar segment covering it or an empty spacer. */}
                {band.laneCount > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {Array.from({ length: band.laneCount }, (_, lane) => {
                      const slot = band.slots.find(
                        (s) =>
                          s.lane === lane &&
                          di >= s.startIdx &&
                          di <= s.endIdx,
                      );
                      if (!slot) {
                        return <div key={lane} className="h-[18px]" />;
                      }
                      return (
                        <AllDayBar
                          key={lane}
                          slot={slot}
                          di={di}
                          selfKey={selfKey}
                          onClick={onEventClick}
                        />
                      );
                    })}
                  </div>
                )}
                {/* Events area: overflow-hidden so chips never bleed
                    past the +N more pill at the bottom of the cell. */}
                <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                  {visible.map((ev) => (
                    <EventChip
                      key={ev.id}
                      ev={ev}
                      selfKey={selfKey}
                      onClick={onEventClick}
                    />
                  ))}
                </div>
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayFocus(cell.date);
                    }}
                    className="mt-1 w-full truncate rounded-md bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold text-court-fg-muted transition hover:bg-court-border-soft hover:text-court-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-court-brand"
                    aria-label={`Open all events for ${cell.date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}`}
                  >
                    +{overflow} more
                  </button>
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
  const meta = eventTypeMeta(ev.type);
  const colorStyle = googleEventColorStyle(ev.calendarColor);
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
          colorStyle
            ? "shadow-sm"
            : isOwned
              ? meta.pillClass
              : "border-court-border bg-court-surface-subtle text-court-fg",
        )}
        style={colorStyle}
      >
        {ev.title}
      </div>
    );
  }
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick(ev);
      }}
      className={cn(
        "cursor-pointer truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight",
        colorStyle ? "font-semibold shadow-sm" : meta.pillClass,
      )}
      style={colorStyle}
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

// One week-row segment of an all-day block. Rounds only on the span's true
// start/end (square, border-dropped, and bled with a negative margin into
// the cell padding everywhere else) so consecutive days touch and read as a
// single continuous bar. The title shows on the start day and again at each
// week wrap (Monday); continuation cells render a same-height blank bar.
function AllDayBar({
  slot,
  di,
  selfKey,
  onClick,
}: {
  slot: AllDaySlot;
  di: number;
  selfKey: string | null;
  onClick: (ev: CalendarEvent) => void;
}) {
  const { ev } = slot;
  const meta = eventTypeMeta(ev.type);
  const colorStyle = googleEventColorStyle(ev.calendarColor);
  const isOwned =
    selfKey == null ||
    ev.ownerKeys.length === 0 ||
    ev.ownerKeys.includes(selfKey);
  const isStart = di === slot.startIdx && !slot.startsBefore;
  const isEnd = di === slot.endIdx && !slot.endsAfter;
  const roundLeft = isStart || di === 0;
  const roundRight = isEnd || di === 6;
  const showTitle = isStart || di === 0;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick(ev);
      }}
      title={ev.title}
      className={cn(
        "flex h-[18px] cursor-pointer items-center overflow-hidden border px-1.5 text-[11px] font-semibold leading-none",
        roundLeft ? "rounded-l" : "-ml-2 border-l-0",
        roundRight ? "rounded-r" : "-mr-2 border-r-0",
        colorStyle
          ? "shadow-sm"
          : isOwned
            ? meta.pillClass
            : "border-court-border bg-court-surface-subtle text-court-fg",
      )}
      style={colorStyle ?? undefined}
    >
      <span className="truncate">{showTitle ? ev.title : " "}</span>
    </div>
  );
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
