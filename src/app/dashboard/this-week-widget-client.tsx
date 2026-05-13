"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";
import { eventTypeMeta } from "@/lib/calendar/utils";
import { cn } from "@/lib/utils";

// All formatting (timeLabel, weekdayShort, etc.) happens server-side
// and is passed down as plain strings so SSR + hydration agree
// byte-for-byte. The client component owns drawer state and click
// handlers — every chip and row dispatches openEvent(id) which looks
// up the matching CalendarEvent and opens the same drawer used on
// /calendar in edit mode.

export type DayCellEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  timeLabel: string;
};

export type DayCell = {
  key: string;
  abbr: string;
  dayNum: string;
  isToday: boolean;
  events: DayCellEvent[];
};

export type UpNextRow = {
  id: string;
  timeLabel: string;
  durationMin: number;
  type: CalendarEventType;
  title: string;
};

export type LaterRow = {
  id: string;
  dayAbbr: string;
  timeLabel: string;
  title: string;
};

const PILL_CLASS: Record<CalendarEventType, string> = {
  interview:
    "bg-court-brand-tint text-court-brand-dark dark:bg-court-brand-tint dark:text-court-brand-dark",
  client: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  reminder:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  other: "bg-court-surface-subtle text-court-fg-muted",
};

const PILL_LABEL: Record<CalendarEventType, string> = {
  interview: "Interview",
  client: "Client Call",
  reminder: "Reminder",
  other: "Event",
};

type Props = {
  days: DayCell[];
  upNextToday: UpNextRow[];
  laterRows: LaterRow[];
  laterOverflow: number;
  events: CalendarEvent[];
  todayHeading: string;
  countToday: number;
  countWeek: number;
  nextInLabel: string | null;
};

export function ThisWeekWidgetClient({
  days,
  upNextToday,
  laterRows,
  laterOverflow,
  events,
  todayHeading,
  countToday,
  countWeek,
  nextInLabel,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  const eventsById = useMemo(() => {
    const m = new Map<string, CalendarEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const openEvent = (id: string) => {
    const ev = eventsById.get(id);
    if (!ev) return;
    setSelected(ev);
    setDrawerOpen(true);
  };

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_12px_32px_rgba(0,0,0,.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
            THIS WEEK
          </div>
          <h2
            className="mt-1 font-semibold tracking-[-0.035em] text-court-fg"
            style={{ fontSize: "18px", lineHeight: 1.15 }}
          >
            {todayHeading}
          </h2>
          <p className="mt-1 text-[12px] text-court-fg-muted">
            {countToday} today · {countWeek} this week
            {nextInLabel != null && <> · Next in {nextInLabel}</>}
          </p>
        </div>
        <Link
          href="/calendar"
          className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          Open Calendar
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 5-day strip — chips dispatch openEvent so a click lands in the
          calendar drawer in edit mode without a navigation. */}
      <div className="mt-4 grid grid-cols-5">
        {days.map((day, i) => {
          const visible = day.events.slice(0, day.events.length > 3 ? 2 : 3);
          const overflow = day.events.length - visible.length;
          return (
            <div
              key={day.key}
              className={cn(
                "min-w-0 px-1.5 py-1.5",
                i > 0 && "border-l border-court-border-soft",
                day.isToday && "bg-court-brand-tint/40",
              )}
            >
              <div
                className={cn(
                  "flex items-baseline justify-between px-1",
                  day.isToday && "text-court-brand-dark",
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-extrabold uppercase tracking-[0.12em]",
                    day.isToday ? "text-court-brand-dark" : "text-court-fg-muted",
                  )}
                >
                  {day.abbr}
                </span>
                <span
                  className={cn(
                    "font-serif text-sm font-bold tabular-nums",
                    day.isToday ? "text-court-brand-dark" : "text-court-fg",
                  )}
                >
                  {day.dayNum}
                </span>
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {visible.length === 0 ? (
                  <span className="px-1 text-[10px] font-medium text-court-fg-dim">
                    —
                  </span>
                ) : (
                  visible.map((e) => {
                    const meta = eventTypeMeta(e.type);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => openEvent(e.id)}
                        title={`${e.timeLabel} · ${e.title}`}
                        className={cn(
                          "block min-w-0 truncate rounded-md border px-1.5 py-0.5 text-left leading-tight transition hover:brightness-95 focus:outline-none focus:ring-1 focus:ring-court-brand/40",
                          meta.pillClass,
                        )}
                      >
                        <div className="truncate text-[10.5px] font-semibold">
                          {e.title}
                        </div>
                        <div className="truncate text-[9.5px] opacity-80">
                          {e.timeLabel}
                        </div>
                      </button>
                    );
                  })
                )}
                {overflow > 0 && (
                  <div className="truncate rounded-md bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold text-court-fg-muted">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Up next today */}
      <div className="mt-5">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Up next today
        </div>
        {upNextToday.length === 0 ? (
          <div className="mt-2 text-[13px] text-court-fg-dim">
            Nothing else today
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border-soft">
            {upNextToday.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openEvent(r.id)}
                  className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-court-surface-subtle/60 focus:outline-none focus:ring-1 focus:ring-court-brand/40"
                >
                  <span className="w-[72px] shrink-0 text-[13px] font-semibold tabular-nums text-court-fg">
                    {r.timeLabel}
                  </span>
                  <span className="w-10 shrink-0 text-[11px] font-medium text-court-fg-muted">
                    {r.durationMin}m
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      PILL_CLASS[r.type],
                    )}
                  >
                    {PILL_LABEL[r.type]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-court-fg">
                    {r.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Later this week — plain rows (no decorative tint or border).
          Matches the Up Next Today section so the two read as one
          continuous list. */}
      <div className="mt-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Later this week
        </div>
        {laterRows.length === 0 ? (
          <div className="mt-2 text-[13px] text-court-fg-dim">
            Nothing else scheduled
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border-soft">
            {laterRows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openEvent(r.id)}
                  className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-court-surface-subtle/60 focus:outline-none focus:ring-1 focus:ring-court-brand/40"
                >
                  <span className="w-8 shrink-0 text-xs text-court-fg-muted">
                    {r.dayAbbr}
                  </span>
                  <span className="w-20 shrink-0 text-[13px] font-medium tabular-nums text-court-fg">
                    {r.timeLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-court-fg">
                    {r.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {laterOverflow > 0 && (
          <div className="mt-2 text-[11px] font-semibold text-court-fg-muted">
            + {laterOverflow} more this week
          </div>
        )}
      </div>

      <CalendarEventDrawer
        open={drawerOpen}
        mode="edit"
        event={selected}
        prefill={null}
        onClose={() => setDrawerOpen(false)}
      />
    </section>
  );
}
