"use client";

import { MapPin, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";

import type { CalendarEvent, CalendarTeamMember } from "@/lib/calendar/types";
import {
  computeReminderLanes,
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
const MAX_AVATARS = 2;

type Props = {
  events: CalendarEvent[];
  selectedId: string | null;
  teamMode: boolean;
  teamMembers: CalendarTeamMember[];
  hiddenMembers: Set<string>;
  displayDate: Date;
  today: Date;
  now: Date;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (hour: number, minute: number) => void;
};

export function CalendarDayView({
  events,
  selectedId,
  teamMode,
  teamMembers,
  hiddenMembers,
  displayDate,
  today,
  now,
  onEventClick,
  onSlotClick,
}: Props) {
  const dayEvents = events.filter(
    (e) =>
      isSameDay(e.startTime, displayDate) &&
      !(
        e.ownerKeys.length > 0 && e.ownerKeys.every((k) => hiddenMembers.has(k))
      ),
  );
  const isToday = isSameDay(displayDate, today);
  const lanes = computeReminderLanes(dayEvents);

  // Local "now" ticking once a minute so the brand-green current-time
  // line drifts down the column while the page sits open. Initialized
  // from the `now` prop so SSR and the first client render agree;
  // after mount the local clock takes over.
  const [liveNow, setLiveNow] = useState<Date>(now);
  useEffect(() => {
    if (!isToday) return;
    setLiveNow(new Date());
    const id = window.setInterval(() => setLiveNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [isToday, displayDate]);

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
          {isToday && <> · It is {fmtTime(liveNow)}</>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "56px 1fr" }}>
        <div>
          {HOURS.map((h) => (
            <div
              key={h}
              className="-translate-y-2 px-2 text-right text-[10.5px] font-semibold text-court-fg-muted"
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
              onClick={(e) => {
                // Convert offsetY within the slot to a 15-minute snap
                // so the drawer pre-fills the time the user *meant*
                // (top of the slot → :00, middle → :30, etc.). Cap at
                // :45 so we never roll the click into the next hour.
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const raw = Math.round((offsetY / SLOT) * 4) * 15;
                const minute = Math.min(45, Math.max(0, raw));
                onSlotClick(h, minute);
              }}
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
            const rawHeight = (end - start) * SLOT - 4;
            // Floor reminder height so a 15-min reminder stays readable.
            const height =
              ev.type === "reminder" ? Math.max(rawHeight, 30) : rawHeight;
            const allOwners = teamMode
              ? ev.ownerKeys
                  .map((k) => teamMembers.find((m) => m.id === k))
                  .filter((m): m is NonNullable<typeof m> => Boolean(m))
              : [];
            // Cap the visible stack at 2; the rest become a "+N" pill.
            const visibleOwners = allOwners.slice(0, MAX_AVATARS);
            const extraOwners = allOwners.length - visibleOwners.length;
            const guestCount = ev.guests?.length ?? 0;
            const isSelected = selectedId === ev.id;
            // Split the column into left/right lanes when a reminder and
            // event share this slot so neither tile covers the other.
            const lane = lanes.get(ev.id) ?? "full";
            const laneStyle =
              lane === "left"
                ? { left: 14, right: "calc(50% + 4px)" }
                : lane === "right"
                  ? { left: "calc(50% + 4px)", right: 24 }
                  : { left: 14, right: 24 };
            // Half-width lane tiles can't fit the rich header + title +
            // detail rows without wrapping and clipping, so a collided
            // tile renders a compact label + title pair instead.
            if (lane !== "full") {
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(ev);
                  }}
                  className={cn(
                    "absolute cursor-pointer overflow-hidden rounded-lg border px-3 py-1.5 text-left leading-tight transition hover:-translate-y-px hover:shadow-sm",
                    meta.pillClass,
                    isSelected &&
                      "outline outline-2 outline-offset-2 outline-court-brand",
                  )}
                  style={{ top, height, ...laneStyle }}
                >
                  <div className="truncate text-[10px] font-bold uppercase tracking-[0.1em]">
                    {meta.label}
                  </div>
                  <div className="truncate text-[12.5px] font-semibold text-court-fg">
                    {ev.title}
                  </div>
                  {height >= 58 && (
                    <div className="truncate text-[10.5px] opacity-70">
                      {fmtDateRange(ev.startTime, ev.endTime)}
                    </div>
                  )}
                </button>
              );
            }
            return (
              <button
                key={ev.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick(ev);
                }}
                className={cn(
                  "absolute cursor-pointer overflow-hidden rounded-lg border px-4 py-3 text-left transition hover:-translate-y-px hover:shadow-sm",
                  meta.pillClass,
                  isSelected &&
                    "outline outline-2 outline-offset-2 outline-court-brand",
                )}
                style={{ top, height, ...laneStyle }}
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
                  {allOwners.length > 0 && (
                    <span className="flex shrink-0 -space-x-1.5">
                      {visibleOwners.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white"
                          style={{ background: m.color }}
                          title={m.name}
                        >
                          {m.initials}
                        </span>
                      ))}
                      {extraOwners > 0 && (
                        <span
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-court-surface-subtle text-[10px] font-bold text-court-fg"
                          title={`${extraOwners} more`}
                        >
                          +{extraOwners}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {isToday && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-[4] h-0.5 bg-court-brand"
              style={{ top: (decimalHour(liveNow) - START_HOUR) * SLOT }}
            >
              <span className="absolute -left-1.5 -top-1 inline-block h-2.5 w-2.5 rounded-full bg-court-brand shadow-[0_0_0_3px_rgba(90,150,66,0.18)]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
