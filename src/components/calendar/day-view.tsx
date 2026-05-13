"use client";

import { Briefcase, MapPin, Plus, Users } from "lucide-react";

import {
  NOW_HOUR,
  NOW_MIN,
  SAMPLE_TEAM,
  TODAY_INDEX,
} from "@/lib/calendar/sample-data";
import type { CalendarEvent } from "@/lib/calendar/types";
import { eventTypeMeta, fmtHour, fmtRange } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const SLOT = 88;

type Props = {
  events: CalendarEvent[];
  selectedId: string | null;
  teamMode: boolean;
  visibleMembers: string[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (hour: number) => void;
};

export function CalendarDayView({
  events,
  selectedId,
  teamMode,
  visibleMembers,
  onEventClick,
  onSlotClick,
}: Props) {
  const dayEvents = events.filter(
    (e) => e.day === TODAY_INDEX && (!teamMode || visibleMembers.includes(e.ownerId)),
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="border-b border-court-border px-7 py-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-brand-dark">
          Tuesday
        </div>
        <div className="mt-0.5 font-serif text-[26px] font-semibold text-court-fg">
          May 12, 2026
        </div>
        <div className="text-xs text-court-fg-muted">
          {dayEvents.length} events ·{" "}
          {dayEvents.filter((e) => e.type === "interview").length} interviews · It is{" "}
          {fmtHour(NOW_HOUR + NOW_MIN / 60)}
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
            const top = (ev.start - 7) * SLOT;
            const height = (ev.end - ev.start) * SLOT - 4;
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
                        {fmtRange(ev.start, ev.end)}
                      </span>
                    </div>
                    <div className="mt-1 font-serif text-base font-semibold text-court-fg">
                      {ev.title}
                    </div>
                    <div className="text-[12.5px] text-court-fg">{ev.meta}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px]">
                      {ev.where && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {ev.where}
                        </span>
                      )}
                      {ev.guests.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {ev.guests.length} guests
                        </span>
                      )}
                      {ev.type === "interview" && ev.job && (
                        <span className="inline-flex items-center gap-1">
                          <Briefcase className="h-3 w-3" /> {ev.job}
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
          {/* now line */}
          <div
            className="pointer-events-none absolute left-0 right-0 z-[4] h-0.5"
            style={{ top: (NOW_HOUR + NOW_MIN / 60 - 7) * SLOT, background: "#E11D48" }}
          >
            <span
              className="absolute -left-1.5 -top-1 inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: "#E11D48",
                boxShadow: "0 0 0 3px rgba(225,29,72,.18)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
