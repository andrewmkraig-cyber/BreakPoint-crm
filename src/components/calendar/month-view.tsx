"use client";

import { WEEK_DAYS } from "@/lib/calendar/sample-data";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta, fmtHour } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

type Props = {
  events: CalendarEvent[];
  teamMode: boolean;
  visibleMembers: string[];
  onEventClick: (event: CalendarEvent) => void;
  onWeekClick: () => void;
};

type MonthCell = {
  d: number;
  // outsideMonth, today, currentWeek hint flags. nextMonth covers cells
  // at the bottom that belong to June.
  outsideMonth?: boolean;
  today?: boolean;
  inCurrentWeek?: boolean;
  nextMonth?: boolean;
};

// May 2026 fixture: the 1st is Friday, current week is May 11 to 17,
// today is May 12. Mon-first 6-row grid.
const WEEKS: MonthCell[][] = [
  [
    { d: 27, outsideMonth: true },
    { d: 28, outsideMonth: true },
    { d: 29, outsideMonth: true },
    { d: 30, outsideMonth: true },
    { d: 1 },
    { d: 2 },
    { d: 3 },
  ],
  [{ d: 4 }, { d: 5 }, { d: 6 }, { d: 7 }, { d: 8 }, { d: 9 }, { d: 10 }],
  [
    { d: 11, inCurrentWeek: true },
    { d: 12, today: true, inCurrentWeek: true },
    { d: 13, inCurrentWeek: true },
    { d: 14, inCurrentWeek: true },
    { d: 15, inCurrentWeek: true },
    { d: 16, inCurrentWeek: true },
    { d: 17, inCurrentWeek: true },
  ],
  [{ d: 18 }, { d: 19 }, { d: 20 }, { d: 21 }, { d: 22 }, { d: 23 }, { d: 24 }],
  [{ d: 25 }, { d: 26 }, { d: 27 }, { d: 28 }, { d: 29 }, { d: 30 }, { d: 31 }],
  [
    { d: 1, nextMonth: true, outsideMonth: true },
    { d: 2, nextMonth: true, outsideMonth: true },
    { d: 3, nextMonth: true, outsideMonth: true },
    { d: 4, nextMonth: true, outsideMonth: true },
    { d: 5, nextMonth: true, outsideMonth: true },
    { d: 6, nextMonth: true, outsideMonth: true },
    { d: 7, nextMonth: true, outsideMonth: true },
  ],
];

// Sprinkled placeholder events for cells outside the current week so
// the month grid has texture. These render as type-colored pills with
// no click target since they have no real id.
const SPRINKLE: Record<number, Array<{ type: CalendarEventType; title: string }>> = {
  4: [{ type: "client", title: "Capstone weekly" }],
  5: [
    { type: "interview", title: "Phone screen – Ben Liu" },
    { type: "other", title: "Pipeline review" },
  ],
  6: [{ type: "interview", title: "Phone screen – Maya R." }],
  7: [
    { type: "client", title: "Heat & Control sync" },
    { type: "interview", title: "R3 – Tom Ng" },
  ],
  8: [{ type: "personal", title: "PTO afternoon" }],
  18: [{ type: "interview", title: "Final – Lucas M." }],
  19: [
    { type: "client", title: "Lakefront sync" },
    { type: "interview", title: "Screen – Avery J." },
  ],
  20: [{ type: "interview", title: "R2 – Jordan O." }],
  21: [
    { type: "other", title: "Team offsite" },
    { type: "other", title: "All-hands" },
  ],
  22: [{ type: "interview", title: "Final – Becca H." }],
  26: [{ type: "interview", title: "Screen – Nina P." }],
  27: [
    { type: "client", title: "Rust Belt sync" },
    { type: "interview", title: "R2 – Aiden S." },
  ],
  28: [
    { type: "personal", title: "Doctor" },
    { type: "interview", title: "R2 – Will B." },
  ],
  29: [{ type: "other", title: "Quarter wrap" }],
};

export function CalendarMonthView({
  events,
  teamMode,
  visibleMembers,
  onEventClick,
  onWeekClick,
}: Props) {
  const eventsByDate: Record<number, CalendarEvent[]> = {};
  for (const e of events) {
    if (teamMode && !visibleMembers.includes(e.ownerId)) continue;
    const date = WEEK_DAYS[e.day]?.date;
    if (date == null) continue;
    eventsByDate[date] ??= [];
    eventsByDate[date].push(e);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="grid grid-cols-7 border-b border-court-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="py-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridTemplateRows: "repeat(6, minmax(116px, 1fr))" }}>
        {WEEKS.flatMap((week, wi) =>
          week.map((cell, di) => {
            const real = cell.outsideMonth ? undefined : eventsByDate[cell.d];
            const sprinkled = cell.outsideMonth ? undefined : SPRINKLE[cell.d];
            const dayEvents: Array<CalendarEvent | { type: CalendarEventType; title: string }> =
              real ?? sprinkled ?? [];
            return (
              <button
                key={`${wi}-${di}`}
                type="button"
                onClick={() => cell.inCurrentWeek && onWeekClick()}
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
                      cell.today ? "bg-court-brand text-white" : "text-court-fg",
                    )}
                  >
                    {cell.d}
                  </span>
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] font-semibold text-court-fg-muted">
                      +{dayEvents.length - 3}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  {dayEvents.slice(0, 3).map((ev, ei) => {
                    const meta = eventTypeMeta(ev.type);
                    const isReal = "id" in ev;
                    return (
                      <div
                        key={ei}
                        onClick={(e) => {
                          if (!isReal) return;
                          e.stopPropagation();
                          onEventClick(ev as CalendarEvent);
                        }}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] leading-tight",
                          meta.pillClass,
                          isReal && "cursor-pointer",
                        )}
                      >
                        <div className="truncate font-semibold">
                          {isReal && "start" in ev && (
                            <span className="font-medium opacity-70">
                              {fmtHour((ev as CalendarEvent).start)} ·{" "}
                            </span>
                          )}
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
