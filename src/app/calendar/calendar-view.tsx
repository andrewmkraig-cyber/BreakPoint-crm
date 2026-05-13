"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import { CalendarDayView } from "@/components/calendar/day-view";
import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import { GoogleGlyph } from "@/components/calendar/left-rail";
import { CalendarLeftRail } from "@/components/calendar/left-rail";
import { CalendarMonthView } from "@/components/calendar/month-view";
import { CalendarRemindersPanel } from "@/components/calendar/reminders-panel";
import { CalendarToastStack } from "@/components/calendar/toast-stack";
import { CalendarWeekView } from "@/components/calendar/week-view";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  MONTH_NAME,
  SAMPLE_EVENTS,
  SAMPLE_REMINDERS,
  SAMPLE_TEAM,
  WEEK_DAYS,
  YEAR,
} from "@/lib/calendar/sample-data";
import type {
  CalendarEvent,
  CalendarScope,
  CalendarView,
} from "@/lib/calendar/types";

// Calendar surface owner. Holds view / scope / drawer / toast state and
// passes the right slices to each child. The page is a server component;
// everything interactive lives here.

export function CalendarView() {
  const [view, setView] = useState<CalendarView>("week");
  const [scope, setScope] = useState<CalendarScope>("me");
  const [visibleMembers, setVisibleMembers] = useState<string[]>(
    SAMPLE_TEAM.map((m) => m.id),
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("edit");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    SAMPLE_EVENTS.find((e) => e.id === "e5") ?? null,
  );

  const [toasts, setToasts] = useState(SAMPLE_REMINDERS.filter((r) => r.urgent));
  const [toastsCollapsed, setToastsCollapsed] = useState(false);
  const [reminders, setReminders] = useState(SAMPLE_REMINDERS);

  const teamMode = scope === "team";
  const weekStart = WEEK_DAYS[0].date;
  const weekEnd = WEEK_DAYS[WEEK_DAYS.length - 1].date;

  const openCreate = () => {
    setSelectedEvent(null);
    setDrawerMode("create");
    setDrawerOpen(true);
  };
  const openEdit = (ev: CalendarEvent) => {
    setSelectedEvent(ev);
    setDrawerMode("edit");
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);

  const toggleMember = (id: string) =>
    setVisibleMembers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((r) => r.id !== id));
  const snoozeToast = (id: string) =>
    setToasts((prev) => prev.filter((r) => r.id !== id));
  const dismissReminder = (id: string) =>
    setReminders((prev) => prev.filter((r) => r.id !== id));
  const snoozeReminder = (id: string) =>
    setReminders((prev) => prev.filter((r) => r.id !== id));

  const myEvents = scope === "me"
    ? SAMPLE_EVENTS.filter((e) => e.ownerId === "ak")
    : SAMPLE_EVENTS;

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-5">
      <CalHeader onNew={openCreate} />
      <CalSubheader
        view={view}
        scope={scope}
        teamModeCount={SAMPLE_EVENTS.length}
        myCount={SAMPLE_EVENTS.filter((e) => e.ownerId === "ak").length}
        weekRange={`${MONTH_NAME} ${weekStart} – ${weekEnd}`}
        year={YEAR}
        onView={setView}
        onScope={setScope}
      />

      <div className="flex min-w-0 gap-5">
        <CalendarLeftRail
          teamMode={teamMode}
          visibleMembers={visibleMembers}
          onToggleMember={toggleMember}
        />

        <div className="min-w-0 flex-1">
          {view === "week" && (
            <CalendarWeekView
              events={myEvents}
              selectedId={selectedEvent?.id ?? null}
              teamMode={teamMode}
              visibleMembers={visibleMembers}
              onEventClick={openEdit}
              onSlotClick={openCreate}
            />
          )}
          {view === "day" && (
            <CalendarDayView
              events={myEvents}
              selectedId={selectedEvent?.id ?? null}
              teamMode={teamMode}
              visibleMembers={visibleMembers}
              onEventClick={openEdit}
              onSlotClick={openCreate}
            />
          )}
          {view === "month" && (
            <CalendarMonthView
              events={myEvents}
              teamMode={teamMode}
              visibleMembers={visibleMembers}
              onEventClick={openEdit}
              onWeekClick={() => setView("week")}
            />
          )}
        </div>

        <aside className="hidden w-[280px] shrink-0 lg:block">
          <CalendarRemindersPanel
            reminders={reminders}
            onDismiss={dismissReminder}
            onSnooze={snoozeReminder}
          />
        </aside>
      </div>

      <CalendarEventDrawer
        open={drawerOpen}
        mode={drawerMode}
        event={drawerMode === "edit" ? selectedEvent : null}
        onClose={closeDrawer}
      />

      <CalendarToastStack
        reminders={toasts}
        collapsed={toastsCollapsed}
        onCollapse={setToastsCollapsed}
        onDismiss={dismissToast}
        onSnooze={snoozeToast}
      />
    </div>
  );
}

// ---- Page header ----
function CalHeader({ onNew }: { onNew: () => void }) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <h1 className="font-serif text-3xl font-black leading-none tracking-tight text-court-fg sm:text-4xl">
        Calendar
      </h1>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-court-brand bg-court-surface px-5 py-2.5 text-sm font-semibold text-court-brand-dark transition hover:bg-court-brand-tint/40 hover:shadow-[0_0_0_4px_rgba(90,150,66,0.08)]"
      >
        <Plus className="h-3.5 w-3.5" /> New event
      </button>
    </header>
  );
}

// ---- Subheader: date nav + scope + view tabs ----
function CalSubheader({
  view,
  scope,
  teamModeCount,
  myCount,
  weekRange,
  year,
  onView,
  onScope,
}: {
  view: CalendarView;
  scope: CalendarScope;
  teamModeCount: number;
  myCount: number;
  weekRange: string;
  year: number;
  onView: (v: CalendarView) => void;
  onScope: (s: CalendarScope) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous"
          className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Next"
          className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="ml-1 h-9 rounded-full border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          Today
        </button>
      </div>
      <div className="min-w-0">
        <div className="font-serif text-xl font-bold tracking-tight tabular-nums text-court-fg sm:text-[22px]">
          {weekRange}{" "}
          <span className="font-medium text-court-fg-muted">{year}</span>
        </div>
        <div className="mt-0.5 hidden items-center gap-1.5 text-[11px] text-court-fg-muted lg:flex">
          <GoogleGlyph className="h-3 w-3" /> Synced 2 min ago · America/New_York
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <TabStrip<CalendarScope>
          ariaLabel="Calendar scope"
          activeId={scope}
          onChange={onScope}
          items={[
            { id: "me", label: "My Calendar", count: myCount },
            { id: "team", label: "Team", count: teamModeCount },
          ]}
        />
        <span className="hidden h-[22px] w-px bg-court-border xl:inline-block" />
        <TabStrip<CalendarView>
          ariaLabel="Calendar view"
          activeId={view}
          onChange={onView}
          items={[
            { id: "day", label: "Day" },
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
          ]}
        />
      </div>
    </div>
  );
}
