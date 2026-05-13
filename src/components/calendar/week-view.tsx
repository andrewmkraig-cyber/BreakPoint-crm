"use client";

import { Plus } from "lucide-react";
import { useMemo } from "react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
import { eventTypeMeta, fmtHour, hourToY, SLOT_HEIGHT } from "@/lib/calendar/utils";
import {
  decimalHour,
  getWorkWeekDays,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

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
}: Props) {
  const weekDays = useMemo(() => getWorkWeekDays(weekStart), [weekStart]);

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

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      {/* Day headers */}
      <div
        className="grid border-b border-court-border"
        style={{ gridTemplateColumns: "56px repeat(5, minmax(0, 1fr))" }}
      >
        <div />
        {weekDays.map((d) => {
          const isToday = isSameDay(d.fullDate, today);
          return (
            <div
              key={d.key}
              className={cn(
                "border-b border-court-border py-3.5 text-center",
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
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div className="relative">
        <div
          className="grid"
          style={{ gridTemplateColumns: "56px repeat(5, minmax(0, 1fr))" }}
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
                  const height = hourToY(end) - hourToY(start) - 2;
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
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className={cn(
                        "absolute left-1 right-1 cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left leading-tight transition hover:-translate-y-px hover:shadow-md",
                        meta.pillClass,
                        isSelected &&
                          "outline-2 outline-offset-2 outline outline-court-brand",
                      )}
                      style={{ top, height }}
                    >
                      {owners.length > 0 && (
                        <span className="absolute right-1 top-1 flex -space-x-1">
                          {owners.map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white text-[8px] font-bold text-white"
                              style={{ background: m.color }}
                              title={m.name}
                            >
                              {m.initials}
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
      className="pointer-events-none absolute -left-1.5 right-0 z-[4] h-0.5"
      style={{ top: y, background: "#E11D48" }}
    >
      <span
        className="absolute -left-1.5 -top-1 inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: "#E11D48", boxShadow: "0 0 0 3px rgba(225,29,72,.18)" }}
      />
    </div>
  );
}
