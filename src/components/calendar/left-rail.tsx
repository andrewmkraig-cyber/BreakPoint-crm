"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { SAMPLE_TEAM } from "@/lib/calendar/sample-data";
import {
  addDays,
  getDaysInMonth,
  getMondayOfWeek,
  getMonthName,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

type Props = {
  teamMode: boolean;
  visibleMembers: string[];
  onToggleMember: (id: string) => void;
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
};

// Slim left rail. Three stacked cards (mini-cal, event-types legend,
// team checkboxes) plus a small Google sync footer. Width is fixed at
// 200px so the main grid keeps its breathing room.

export function CalendarLeftRail({
  teamMode,
  visibleMembers,
  onToggleMember,
  monthStart,
  currentWeekStart,
  today,
}: Props) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col gap-4 xl:flex">
      <MiniMonth
        monthStart={monthStart}
        currentWeekStart={currentWeekStart}
        today={today}
      />
      <EventTypeLegend />
      <TeamList
        teamMode={teamMode}
        visibleMembers={visibleMembers}
        onToggleMember={onToggleMember}
      />
      <GoogleSyncFooter />
    </aside>
  );
}

function MiniMonth({
  monthStart,
  currentWeekStart,
  today,
}: {
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
}) {
  // Mon-first 6×7 grid for the displayed month. Cells outside the
  // month fade to ~60% opacity; the current week is tinted; today
  // gets the brand pill.
  const cells = useMemo(() => {
    const gridStart = getMondayOfWeek(monthStart);
    const days: Array<{ date: Date; outsideMonth: boolean }> = [];
    const daysInMonth = getDaysInMonth(monthStart);
    // 6 weeks × 7 days covers any month layout. Trim trailing all-out
    // rows to keep the mini-cal compact.
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(gridStart, i);
      days.push({ date: d, outsideMonth: d.getMonth() !== monthStart.getMonth() });
    }
    // Trim trailing rows that are entirely outside the month.
    while (days.length > 28 && days.slice(-7).every((c) => c.outsideMonth)) {
      days.splice(-7, 7);
    }
    return { days, daysInMonth };
  }, [monthStart]);

  const weekEnd = addDays(currentWeekStart, 4);

  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-serif text-sm font-semibold text-court-fg">
          {getMonthName(monthStart)} {monthStart.getFullYear()}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            className="grid h-[22px] w-[22px] place-items-center rounded-full border border-court-border text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
          >
            <ChevronLeft className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            className="grid h-[22px] w-[22px] place-items-center rounded-full border border-court-border text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
          >
            <ChevronRight className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[9.5px]">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="font-bold uppercase text-court-fg-muted">
            {d}
          </div>
        ))}
        {cells.days.map(({ date, outsideMonth }) => {
          const isToday = isSameDay(date, today);
          const inWeek =
            date >= currentWeekStart && date <= weekEnd && date.getDay() !== 0 && date.getDay() !== 6;
          return (
            <div
              key={date.toISOString()}
              className="flex items-center justify-center py-0.5 text-[10.5px]"
            >
              <span
                className={cn(
                  "inline-flex h-[19px] w-[19px] items-center justify-center rounded-full tabular-nums",
                  isToday
                    ? "bg-court-brand font-bold text-white"
                    : inWeek
                      ? "bg-court-brand-tint font-semibold text-court-fg"
                      : outsideMonth
                        ? "font-medium text-court-fg-dim opacity-60"
                        : "font-medium text-court-fg",
                )}
              >
                {date.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventTypeLegend() {
  const items: Array<{ label: string; chip: string; ring: string }> = [
    {
      label: "Interview",
      chip: "bg-court-brand-tint",
      ring: "border-court-brand",
    },
    {
      label: "Client Call",
      chip: "bg-blue-50 dark:bg-blue-950/40",
      ring: "border-blue-300 dark:border-blue-700",
    },
    {
      label: "Reminder",
      chip: "bg-amber-50 dark:bg-amber-950/40",
      ring: "border-amber-300 dark:border-amber-700",
    },
    {
      label: "Other",
      chip: "bg-court-surface-subtle",
      ring: "border-court-border",
    },
  ];
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
        Event types
      </div>
      <ul className="space-y-1.5 text-[12px]">
        {items.map((t) => (
          <li key={t.label} className="flex items-center gap-2">
            <span className={cn("h-3 w-3 rounded-sm border-[1.5px]", t.chip, t.ring)} />
            <span className="text-court-fg">{t.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamList({
  teamMode,
  visibleMembers,
  onToggleMember,
}: {
  teamMode: boolean;
  visibleMembers: string[];
  onToggleMember: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
          Team
        </div>
        {!teamMode && (
          <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-court-fg-dim">
            Off
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {SAMPLE_TEAM.map((m) => {
          const on = visibleMembers.includes(m.id);
          const interactive = teamMode;
          return (
            <li
              key={m.id}
              onClick={() => interactive && onToggleMember(m.id)}
              className={cn(
                "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition",
                interactive ? "cursor-pointer hover:bg-court-brand-tint/40" : "opacity-60",
              )}
            >
              <span
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border-[1.5px]"
                style={{
                  background: on ? m.color : "transparent",
                  borderColor: on ? m.color : "rgb(var(--court-border))",
                }}
              >
                {on && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
              </span>
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: m.color }}
              >
                {m.initials}
              </span>
              <span className="truncate text-[12px] text-court-fg">
                {m.name.split(" ")[0]}
                {m.self && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-court-fg-muted">
                    You
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GoogleSyncFooter() {
  return (
    <div className="flex items-center gap-1.5 px-1 text-[10.5px] text-court-fg-muted">
      <GoogleGlyph className="h-3 w-3" />
      Google · Connected
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#34A853"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#EA4335"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export { GoogleGlyph };
