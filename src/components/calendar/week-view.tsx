"use client";

import { Plus } from "lucide-react";
import { useMemo } from "react";

import {
  NOW_HOUR,
  NOW_MIN,
  SAMPLE_TEAM,
  TODAY_INDEX,
  WEEK_DAYS,
} from "@/lib/calendar/sample-data";
import type { CalendarEvent } from "@/lib/calendar/types";
import { eventTypeMeta, fmtHour, hourToY, SLOT_HEIGHT } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

type Props = {
  events: CalendarEvent[];
  selectedId: string | null;
  teamMode: boolean;
  visibleMembers: string[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (day: number, hour: number) => void;
};

export function CalendarWeekView({
  events,
  selectedId,
  teamMode,
  visibleMembers,
  onEventClick,
  onSlotClick,
}: Props) {
  const eventsByDay = useMemo(() => {
    const out: CalendarEvent[][] = WEEK_DAYS.map(() => []);
    for (const e of events) {
      if (teamMode && !visibleMembers.includes(e.ownerId)) continue;
      out[e.day]?.push(e);
    }
    return out;
  }, [events, teamMode, visibleMembers]);

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      {/* Day headers */}
      <div
        className="grid border-b border-court-border"
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
      >
        <div />
        {WEEK_DAYS.map((d, i) => {
          const isToday = i === TODAY_INDEX;
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
          {WEEK_DAYS.map((d, i) => {
            const isToday = i === TODAY_INDEX;
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
                  const top = hourToY(ev.start);
                  const height = hourToY(ev.end) - hourToY(ev.start) - 2;
                  const member = teamMode
                    ? SAMPLE_TEAM.find((m) => m.id === ev.ownerId)
                    : null;
                  const isSelected = selectedId === ev.id;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className={cn(
                        "absolute left-1 right-1 cursor-pointer overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition hover:-translate-y-px hover:shadow-md",
                        meta.pillClass,
                        isSelected &&
                          "outline-2 outline-offset-2 outline outline-court-brand",
                      )}
                      style={{ top, height }}
                    >
                      <div className="flex items-start gap-1.5">
                        <div className="flex-1 text-[10.5px] font-semibold opacity-90">
                          {fmtHour(ev.start)}
                        </div>
                        {member && (
                          <span
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                            style={{ background: member.color }}
                          >
                            {member.initials}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs font-semibold">
                        {ev.title}
                      </div>
                      {height > 56 && (
                        <div className="truncate text-[11px] opacity-80">
                          {ev.meta}
                        </div>
                      )}
                    </button>
                  );
                })}
                {/* Now line on today */}
                {isToday && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const y = hourToY(NOW_HOUR + NOW_MIN / 60);
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
