"use client";

import { MapPin, Plus, Users } from "lucide-react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
import {
  eventTypeMeta,
  fmtDateRange,
  fmtHour,
  fmtTime,
} from "@/lib/calendar/utils";
import {
  decimalHour,
  getWeekdayLong,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const SLOT = 88;
const START_HOUR = 7;

type Props = {
  events: CalendarEvent[];
  selectedId: string | null;
  teamMode: boolean;
  teamMembers: CalendarTeamMember[];
  visibleMembers: string[];
  displayDate: Date;
  today: Date;
  now: Date;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (hour: number) => void;
};

export function CalendarDayView({
  events,
  selectedId,
  teamMode,
  teamMembers,
  visibleMembers,
  displayDate,
  today,
  now,
  onEventClick,
  onSlotClick,
}: Props) {
  const dayEvents = events.filter(
    (e) =>
      isSameDay(e.startTime, displayDate) &&
      (!teamMode || !e.ownerId || visibleMembers.includes(e.ownerId)),
  );
  const isToday = isSameDay(displayDate, today);

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="border-b border-court-border px-7 py-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-brand-dark">
          {getWeekdayLong(displayDate)}
        </div>
        <div className="mt-0.5 font-serif text-[26px] font-semibold text-court-fg">
          {displayDate.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </div>
        <div className="text-xs text-court-fg-muted">
          {dayEvents.length} events ·{" "}
          {dayEvents.filter((e) => e.type === "interview").length} interviews
          {isToday && <> · It is {fmtTime(now)}</>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "84px 1fr" }}>
        <div>
          {HOURS.map((h) => (
            <div
              key={h}
              className="-translate-y-2 pr-3.5 text-right text-[10.5px] font-semibold text-court-fg-muted"
              style={{ height: SLOT }}
            >
              {fmtHour(h)}
            </div>
          ))}
        </div>
        <div className="relative">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onSlotClick(h)}
              className="group relative block w-full cursor-pointer border-t border-court-border-soft text-left transition hover:bg-court-brand-tint/30"
              style={{ height: SLOT }}
            >
              <span className="absolute right-3.5 top-1.5 inline-flex items-center gap-1 text-xs font-semibold text-court-brand-dark opacity-0 transition group-hover:opacity-100">
                <Plus className="h-3 w-3" /> Block this slot
              </span>
            </button>
          ))}
          {dayEvents.map((ev) => {
            const meta = eventTypeMeta(ev.type);
            const start = decimalHour(ev.startTime);
            const end = decimalHour(ev.endTime);
            const top = (start - START_HOUR) * SLOT;
            const height = (end - start) * SLOT - 4;
            const member =
              teamMode && ev.ownerId
                ? teamMembers.find((m) => m.id === ev.ownerId)
                : null;
            const guestCount = ev.guests?.length ?? 0;
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
                  "absolute cursor-pointer overflow-hidden rounded-lg border px-4 py-3 text-left transition hover:-translate-y-px hover:shadow-md",
                  meta.pillClass,
                  isSelected &&
                    "outline outline-2 outline-offset-2 outline-court-brand",
                )}
                style={{ top, height, left: 14, right: 24 }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-bold uppercase tracking-[0.14em]">
                        {meta.label}
                      </span>
                      <span className="opacity-50">·</span>
                      <span className="font-semibold">
                        {fmtDateRange(ev.startTime, ev.endTime)}
                      </span>
                    </div>
                    <div className="mt-1 font-serif text-base font-semibold text-court-fg">
                      {ev.title}
                    </div>
                    {ev.meta && (
                      <div className="text-[12.5px] text-court-fg">{ev.meta}</div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px]">
                      {ev.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {ev.location}
                        </span>
                      )}
                      {guestCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {guestCount} guests
                        </span>
                      )}
                    </div>
                  </div>
                  {member && (
                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: member.color }}
                    >
                      {member.initials}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {isToday && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-[4] h-0.5"
              style={{
                top: (decimalHour(now) - START_HOUR) * SLOT,
                background: "#E11D48",
              }}
            >
              <span
                className="absolute -left-1.5 -top-1 inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: "#E11D48",
                  boxShadow: "0 0 0 3px rgba(225,29,72,.18)",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
