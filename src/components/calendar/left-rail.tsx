"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CalendarTeamMember } from "@/lib/calendar/types";
import {
  addDays,
  addMonths,
  getDaysInMonth,
  getMondayOfWeek,
  getMonthName,
  isSameDay,
} from "@/lib/calendar/week";
import { cn } from "@/lib/utils";

// The four filter chips users see in the legend. "candidate" events are
// folded into "other" for filter purposes so candidate-call rows aren't
// silently dropped when a filter is active — see calendar-view.tsx.
export type EventTypeFilter = "interview" | "client" | "reminder" | "other";

type Props = {
  teamMembers: CalendarTeamMember[];
  // Set of member ids whose events should be hidden from the grid.
  // Click toggles in either scope ("me" / "team") — the checkboxes
  // are not gated on scope anymore because that just turned clicks
  // into a no-op for the common single-recruiter case.
  hiddenMembers: Set<string>;
  onToggleMember: (id: string) => void;
  // Set of event-type filters the recruiter has toggled on. Empty
  // means "no filter" (show all). Non-empty means "show only these".
  selectedEventTypes: Set<EventTypeFilter>;
  onToggleEventType: (type: EventTypeFilter) => void;
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
  // Mini-cal day click → main view jumps to that date (keeps the
  // current view mode, mirroring Google Calendar's side-cal behavior).
  onSelectDate: (date: Date) => void;
};

// Slim left rail. Three stacked cards (mini-cal, event-types legend,
// team checkboxes) plus a small Google sync footer. Width is fixed at
// 200px so the main grid keeps its breathing room.

export function CalendarLeftRail({
  teamMembers,
  hiddenMembers,
  onToggleMember,
  selectedEventTypes,
  onToggleEventType,
  monthStart,
  currentWeekStart,
  today,
  onSelectDate,
}: Props) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col gap-4 xl:flex">
      <MiniMonth
        monthStart={monthStart}
        currentWeekStart={currentWeekStart}
        today={today}
        onSelectDate={onSelectDate}
      />
      <EventTypeLegend
        selectedTypes={selectedEventTypes}
        onToggle={onToggleEventType}
      />
      <TeamList
        teamMembers={teamMembers}
        hiddenMembers={hiddenMembers}
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
  onSelectDate,
}: {
  monthStart: Date;
  currentWeekStart: Date;
  today: Date;
  onSelectDate: (date: Date) => void;
}) {
  // Mini-cal owns its own displayed month so the recruiter can flip
  // through months in the rail without dragging the main grid along.
  // Seeded from the parent's monthStart on first mount; the effect
  // below resyncs whenever the parent navigates to a date in a new
  // month so the side cal follows along instead of going stale.
  // "Jump to today" lives in the main header's Today button; the rail
  // intentionally has no analog.
  const [viewMonth, setViewMonth] = useState<Date>(monthStart);

  // Keep the mini-cal pointing at the same month as the main view's
  // current date — so a Today click, or a day-header click in the main
  // grid, also pulls the rail to that month.
  useEffect(() => {
    setViewMonth((cur) => {
      if (
        cur.getFullYear() === monthStart.getFullYear() &&
        cur.getMonth() === monthStart.getMonth()
      ) {
        return cur;
      }
      return monthStart;
    });
  }, [monthStart]);

  // Mon-first 6×7 grid for the displayed month. Cells outside the
  // month fade to ~60% opacity; the current week is tinted; today
  // gets the brand pill.
  const cells = useMemo(() => {
    const gridStart = getMondayOfWeek(viewMonth);
    const days: Array<{ date: Date; outsideMonth: boolean }> = [];
    const daysInMonth = getDaysInMonth(viewMonth);
    // 6 weeks × 7 days covers any month layout. Trim trailing all-out
    // rows to keep the mini-cal compact.
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(gridStart, i);
      days.push({ date: d, outsideMonth: d.getMonth() !== viewMonth.getMonth() });
    }
    // Trim trailing rows that are entirely outside the month.
    while (days.length > 28 && days.slice(-7).every((c) => c.outsideMonth)) {
      days.splice(-7, 7);
    }
    return { days, daysInMonth };
  }, [viewMonth]);

  const weekEnd = addDays(currentWeekStart, 4);

  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-serif text-sm font-semibold text-court-fg">
          {getMonthName(viewMonth)} {viewMonth.getFullYear()}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
            className="grid h-[22px] w-[22px] place-items-center rounded-full border border-court-border text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
          >
            <ChevronLeft className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
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
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onSelectDate(date)}
              aria-label={`Jump to ${date.toDateString()}`}
              className="flex items-center justify-center rounded py-0.5 text-[10.5px] transition hover:bg-court-brand-tint/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-court-brand"
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventTypeLegend({
  selectedTypes,
  onToggle,
}: {
  selectedTypes: Set<EventTypeFilter>;
  onToggle: (type: EventTypeFilter) => void;
}) {
  // `chip` is the tinted-background look used when the filter is off
  // (matches the legend's original color samples). `fill` is the
  // solid accent the box flips to when the user toggles it on, so the
  // checkmark reads clearly inside. Keeping the same border in both
  // states lets the chip retain its color identity even when unchecked.
  const items: Array<{
    label: string;
    type: EventTypeFilter;
    chip: string;
    fill: string;
    ring: string;
  }> = [
    {
      label: "Interview",
      type: "interview",
      chip: "bg-court-brand-tint",
      fill: "bg-court-brand",
      ring: "border-court-brand",
    },
    {
      label: "Client Call",
      type: "client",
      chip: "bg-blue-50 dark:bg-blue-950/40",
      fill: "bg-blue-500 dark:bg-blue-600",
      ring: "border-blue-300 dark:border-blue-700",
    },
    {
      label: "Reminder",
      type: "reminder",
      chip: "bg-amber-50 dark:bg-amber-950/40",
      fill: "bg-amber-500 dark:bg-amber-600",
      ring: "border-amber-300 dark:border-amber-700",
    },
    {
      label: "Other",
      type: "other",
      chip: "bg-court-surface-subtle",
      fill: "bg-court-fg-muted",
      ring: "border-court-border",
    },
  ];
  // No-filter mode is empty-set, not all-selected — that way a fresh
  // page load still shows everything without us having to seed all
  // four types into state. When at least one chip is on, only its
  // type renders on the grid; clicking the last active chip clears
  // the filter and brings everyone back.
  const anySelected = selectedTypes.size > 0;
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
        Event types
      </div>
      <ul className="space-y-1 text-[12px]">
        {items.map((t) => {
          const active = selectedTypes.has(t.type);
          // When nothing is selected (default), all chips read as
          // "showing" — no dim. When something is selected, dim the
          // chips that aren't part of the active filter so the
          // recruiter can tell at a glance which types the grid is
          // currently honoring.
          const dim = anySelected && !active;
          return (
            <li key={t.type}>
              <button
                type="button"
                onClick={() => onToggle(t.type)}
                aria-pressed={active}
                className={cn(
                  "-mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-court-brand-tint/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-court-brand",
                  dim && "opacity-50",
                )}
              >
                {/* Checkbox: tinted bg when off, accent fill + white
                    check when on. Mirrors the Team checkbox pattern
                    immediately below so the two filter sections read
                    as the same control. */}
                <span
                  className={cn(
                    "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border-[1.5px]",
                    active ? t.fill : t.chip,
                    t.ring,
                  )}
                >
                  {active && (
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                  )}
                </span>
                <span className="text-court-fg">{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TeamList({
  teamMembers,
  hiddenMembers,
  onToggleMember,
}: {
  teamMembers: CalendarTeamMember[];
  hiddenMembers: Set<string>;
  onToggleMember: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
          Team
        </div>
      </div>
      {teamMembers.length === 0 ? (
        <div className="text-[11.5px] text-court-fg-muted">No team members.</div>
      ) : null}
      <ul className="space-y-1">
        {teamMembers.map((m) => {
          const on = !hiddenMembers.has(m.id);
          return (
            <li
              key={m.id}
              onClick={() => onToggleMember(m.id)}
              className={cn(
                "-mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-court-brand-tint/40",
                !on && "opacity-50",
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
