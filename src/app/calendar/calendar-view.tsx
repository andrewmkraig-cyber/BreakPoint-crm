"use client";

import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CalendarDayView } from "@/components/calendar/day-view";
import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import { GoogleGlyph } from "@/components/calendar/left-rail";
import { CalendarLeftRail } from "@/components/calendar/left-rail";
import { CalendarMonthView } from "@/components/calendar/month-view";
import { CalendarRemindersPanel } from "@/components/calendar/reminders-panel";
import { CalendarToastStack } from "@/components/calendar/toast-stack";
import { CalendarWeekView } from "@/components/calendar/week-view";
import { TabStrip } from "@/components/ui/tab-strip";
import type {
  CalendarEvent,
  CalendarReminder,
  CalendarScope,
  CalendarTeamMember,
  CalendarView,
} from "@/lib/calendar/types";
import {
  addDays,
  addMonths,
  formatWeekRange,
  getMondayOfWeek,
  getStartOfMonth,
} from "@/lib/calendar/week";

// Calendar surface owner. Holds view / scope / drawer / toast state and
// passes the right slices to each child. `initialDate` comes from the
// page server component so SSR and CSR agree on "today" — without that
// hand-off, useState(() => new Date()) would resolve at different
// instants on the two sides and risk hydration mismatches.

type Props = {
  initialDate: Date;
  events: CalendarEvent[];
  latestSyncedAt: Date | null;
  teamMembers: CalendarTeamMember[];
  reminders: CalendarReminder[];
};

export function CalendarView({
  initialDate,
  events,
  latestSyncedAt,
  teamMembers,
  reminders: initialReminders,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<CalendarView>("week");
  const [scope, setScope] = useState<CalendarScope>("me");
  const [visibleMembers, setVisibleMembers] = useState<string[]>(
    teamMembers.map((m) => m.id),
  );

  const selfMemberId = teamMembers.find((m) => m.self)?.id ?? teamMembers[0]?.id ?? null;

  // currentDate is the navigation anchor. Week view shows the week
  // containing it; day view shows it; month view shows its month.
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);
  const today = initialDate;

  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch("/api/calendar/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Calendar sync failed", body);
      }
      router.refresh();
    } catch (err) {
      console.error("Calendar sync error", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const currentWeekStart = useMemo(
    () => getMondayOfWeek(currentDate),
    [currentDate],
  );
  const currentMonthStart = useMemo(
    () => getStartOfMonth(currentDate),
    [currentDate],
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("edit");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const [toasts, setToasts] = useState(initialReminders.filter((r) => r.urgent));
  const [toastsCollapsed, setToastsCollapsed] = useState(false);
  const [reminders, setReminders] = useState(initialReminders);

  const teamMode = scope === "team";

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

  const filteredEvents =
    scope === "me"
      ? events.filter((e) => !e.ownerId || e.ownerId === selfMemberId)
      : events;

  const goPrev = () => {
    if (view === "day") setCurrentDate((d) => addDays(d, -1));
    else if (view === "month") setCurrentDate((d) => addMonths(d, -1));
    else setCurrentDate((d) => addDays(d, -7));
  };
  const goNext = () => {
    if (view === "day") setCurrentDate((d) => addDays(d, 1));
    else if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else setCurrentDate((d) => addDays(d, 7));
  };
  const goToday = () => setCurrentDate(today);

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-5">
      <CalHeader onNew={openCreate} />
      <CalSubheader
        view={view}
        scope={scope}
        teamModeCount={events.length}
        myCount={events.filter((e) => !e.ownerId || e.ownerId === selfMemberId).length}
        currentDate={currentDate}
        currentWeekStart={currentWeekStart}
        onView={setView}
        onScope={setScope}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onSync={handleSync}
        isSyncing={isSyncing}
        latestSyncedAt={latestSyncedAt}
      />

      <div className="flex min-w-0 gap-5">
        <CalendarLeftRail
          teamMode={teamMode}
          teamMembers={teamMembers}
          visibleMembers={visibleMembers}
          onToggleMember={toggleMember}
          monthStart={currentMonthStart}
          currentWeekStart={currentWeekStart}
          today={today}
        />

        <div className="min-w-0 flex-1">
          {view === "week" && (
            <CalendarWeekView
              events={filteredEvents}
              selectedId={selectedEvent?.id ?? null}
              teamMode={teamMode}
              teamMembers={teamMembers}
              visibleMembers={visibleMembers}
              weekStart={currentWeekStart}
              today={today}
              now={today}
              onEventClick={openEdit}
              onSlotClick={openCreate}
            />
          )}
          {view === "day" && (
            <CalendarDayView
              events={filteredEvents}
              selectedId={selectedEvent?.id ?? null}
              teamMode={teamMode}
              teamMembers={teamMembers}
              visibleMembers={visibleMembers}
              displayDate={currentDate}
              today={today}
              now={today}
              onEventClick={openEdit}
              onSlotClick={openCreate}
            />
          )}
          {view === "month" && (
            <CalendarMonthView
              events={filteredEvents}
              teamMode={teamMode}
              visibleMembers={visibleMembers}
              monthStart={currentMonthStart}
              currentWeekStart={currentWeekStart}
              today={today}
              onEventClick={openEdit}
              onWeekClick={(weekStart: Date) => {
                setCurrentDate(weekStart);
                setView("week");
              }}
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

function formatSyncedAgo(syncedAt: Date | null): string {
  if (!syncedAt) return "Not synced yet";
  const diffMs = Date.now() - syncedAt.getTime();
  if (diffMs < 0) return "Synced just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} d ago`;
}

// ---- Subheader: date nav + scope + view tabs ----
function CalSubheader({
  view,
  scope,
  teamModeCount,
  myCount,
  currentDate,
  currentWeekStart,
  onView,
  onScope,
  onPrev,
  onNext,
  onToday,
  onSync,
  isSyncing,
  latestSyncedAt,
}: {
  view: CalendarView;
  scope: CalendarScope;
  teamModeCount: number;
  myCount: number;
  currentDate: Date;
  currentWeekStart: Date;
  onView: (v: CalendarView) => void;
  onScope: (s: CalendarScope) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSync: () => void;
  isSyncing: boolean;
  latestSyncedAt: Date | null;
}) {
  const headerText =
    view === "day"
      ? currentDate.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      : view === "month"
        ? currentDate.toLocaleDateString(undefined, {
            month: "long",
          })
        : formatWeekRange(currentWeekStart);
  const yearLabel = (view === "month" ? currentDate : currentWeekStart)
    .getFullYear()
    .toString();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous"
          className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next"
          className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="ml-1 h-9 rounded-full border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          Today
        </button>
      </div>
      <div className="min-w-0">
        <div className="font-serif text-xl font-bold tracking-tight tabular-nums text-court-fg sm:text-[22px]">
          {headerText}{" "}
          <span className="font-medium text-court-fg-muted">{yearLabel}</span>
        </div>
        <div className="mt-0.5 hidden items-center gap-1.5 text-[11px] text-court-fg-muted lg:flex">
          <GoogleGlyph className="h-3 w-3" /> {formatSyncedAgo(latestSyncedAt)} · America/New_York
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
          />
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
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
