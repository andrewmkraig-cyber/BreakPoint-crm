"use client";

import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CalendarDayView } from "@/components/calendar/day-view";
import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import { GoogleGlyph } from "@/components/calendar/left-rail";
import { CalendarLeftRail } from "@/components/calendar/left-rail";
import { CalendarMonthView } from "@/components/calendar/month-view";
import { CalendarRemindersPanel } from "@/components/calendar/reminders-panel";
import { CalendarWeekView } from "@/components/calendar/week-view";
import { TabStrip } from "@/components/ui/tab-strip";
import { useCalendarDrawer } from "@/lib/calendar-drawer-context";
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

import { createReminder, dismissReminder as dismissReminderAction } from "./reminder-actions";

// Persist the recruiter's "show / hide" choices for each teammate
// across navigation. Without this, hiddenMembers reset to its
// default ("My Calendar") every time the user left and came back to
// /calendar, since the component remounts on each navigation.
const HIDDEN_MEMBERS_KEY = "ace.calendar.hiddenMembers";

function readHiddenMembersFromStorage(
  teamMembers: CalendarTeamMember[],
): Set<string> {
  const defaultHidden = new Set(
    teamMembers.filter((m) => !m.self).map((m) => m.id),
  );
  if (typeof window === "undefined") return defaultHidden;
  try {
    const raw = window.localStorage.getItem(HIDDEN_MEMBERS_KEY);
    if (!raw) return defaultHidden;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return new Set(parsed);
    }
  } catch {
    // Malformed JSON — fall through to the default.
  }
  return defaultHidden;
}

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
  // hiddenMembers is the single source of truth for which member's
  // events are showing. The top "My Calendar / Team" tabs and the
  // left-rail checkboxes both mutate this same Set — clicking either
  // surface has a visible effect every time. Default (no stored
  // preference yet): hide everyone who isn't self, which makes the
  // initial page load read as "My Calendar" without needing a
  // separate scope state. Choices persist to localStorage so the rail
  // configuration survives navigation away from /calendar.
  const [hiddenMembers, setHiddenMembers] = useState<Set<string>>(
    () => readHiddenMembersFromStorage(teamMembers),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      HIDDEN_MEMBERS_KEY,
      JSON.stringify(Array.from(hiddenMembers)),
    );
  }, [hiddenMembers]);

  // Master-tab state is derived, not stored. "me" only when every
  // non-self member is hidden AND self is visible; "team" only when
  // no one is hidden. Any in-between rail configuration is a "mixed"
  // state where neither master tab claims to be active — the strip
  // renders both tabs as inactive so the UI never lies about which
  // mode you're in.
  const selfKey = teamMembers.find((m) => m.self)?.id ?? null;
  const nonSelfKeys = teamMembers.filter((m) => !m.self).map((m) => m.id);
  const isMine =
    selfKey != null &&
    !hiddenMembers.has(selfKey) &&
    nonSelfKeys.every((k) => hiddenMembers.has(k));
  const isTeam = hiddenMembers.size === 0;
  const scope: CalendarScope | null = isMine ? "me" : isTeam ? "team" : null;

  const handleScope = (next: CalendarScope) => {
    if (next === "me") {
      setHiddenMembers(
        new Set(teamMembers.filter((m) => !m.self).map((m) => m.id)),
      );
    } else {
      setHiddenMembers(new Set());
    }
  };

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

  // /calendar's local drawer is edit-only now — create flows go
  // through the global drawer mounted in providers so the FAB can
  // pop the same form as an overlay on any other page.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const calendarDrawer = useCalendarDrawer();

  // Upcoming-reminders list shown in the right-rail panel. Past-due
  // toasts are owned by the global ReminderToastProvider mounted in the
  // root layout — keeping them there means a reminder fires even when
  // the recruiter has navigated away from /calendar.
  const [reminders, setReminders] = useState(initialReminders);

  // initialReminders comes back as a fresh prop on every router.refresh,
  // so reset local state when the server payload changes (e.g. after
  // create/dismiss).
  useEffect(() => {
    setReminders(initialReminders);
  }, [initialReminders]);

  // teamMode drives owner-avatar visibility on event tiles. We show
  // avatars whenever the rail isn't strictly in "Me" mode — so a
  // mixed-state rail (Andrew + half the team) still surfaces who owns
  // each event.
  const teamMode = scope !== "me";

  // Create entries — subheader "+ New event" button, grid slot
  // clicks — open the global drawer. The TopBar dispatch and the
  // ComposeFAB "New Event/Reminder" entries don't pass through here
  // anymore; GlobalCalendarDrawer in providers owns those listeners
  // so they fire from any page including /calendar.
  const openCreateAt = (
    date: Date,
    hour?: number,
    minute?: number,
  ) => {
    calendarDrawer.open({ prefill: { date, hour, minute } });
  };
  const openEdit = (ev: CalendarEvent) => {
    setSelectedEvent(ev);
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);

  const toggleMember = (id: string) =>
    setHiddenMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Panel dismiss optimistically drops the row, persists the dismiss
  // server-side, then refreshes so any other surface reading AceReminder
  // (including the global toast provider's next poll) sees the change.
  const persistDismiss = useCallback(
    async (id: string) => {
      try {
        await dismissReminderAction(id);
      } catch (err) {
        console.error("dismissReminder failed", err);
      } finally {
        router.refresh();
      }
    },
    [router],
  );

  const dismissReminder = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    void persistDismiss(id);
  };
  const snoozeReminder = (id: string) =>
    setReminders((prev) => prev.filter((r) => r.id !== id));

  const handleCreateReminder = useCallback(
    async (title: string, reminderAt: Date) => {
      try {
        await createReminder(title, reminderAt.toISOString());
        router.refresh();
      } catch (err) {
        console.error("createReminder failed", err);
        throw err;
      }
    },
    [router],
  );

  // Events flow straight to the grid views — they all filter on
  // hiddenMembers themselves, so no parent-level scope filter is
  // needed. The grids hide an event only when EVERY owner key is
  // hidden, so an event Andrew + Austin both own stays visible until
  // both checkboxes are off.
  const filteredEvents = events;

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
      <CalSubheader
        view={view}
        scope={scope}
        currentDate={currentDate}
        currentWeekStart={currentWeekStart}
        onView={setView}
        onScope={handleScope}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onSync={handleSync}
        isSyncing={isSyncing}
        latestSyncedAt={latestSyncedAt}
        onNewEvent={() => calendarDrawer.open()}
      />

      <div className="flex min-w-0 gap-5">
        <CalendarLeftRail
          teamMembers={teamMembers}
          hiddenMembers={hiddenMembers}
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
              hiddenMembers={hiddenMembers}
              weekStart={currentWeekStart}
              today={today}
              now={today}
              onEventClick={openEdit}
              onSlotClick={(dayIdx, hour) =>
                openCreateAt(addDays(currentWeekStart, dayIdx), hour, 0)
              }
            />
          )}
          {view === "day" && (
            <CalendarDayView
              events={filteredEvents}
              selectedId={selectedEvent?.id ?? null}
              teamMode={teamMode}
              teamMembers={teamMembers}
              hiddenMembers={hiddenMembers}
              displayDate={currentDate}
              today={today}
              now={today}
              onEventClick={openEdit}
              onSlotClick={(hour, minute) =>
                openCreateAt(currentDate, hour, minute)
              }
            />
          )}
          {view === "month" && (
            <CalendarMonthView
              events={filteredEvents}
              hiddenMembers={hiddenMembers}
              teamMembers={teamMembers}
              monthStart={currentMonthStart}
              currentWeekStart={currentWeekStart}
              today={today}
              onEventClick={openEdit}
              onDayClick={(date: Date) => openCreateAt(date)}
            />
          )}
        </div>

        <aside className="hidden w-[280px] shrink-0 lg:block">
          <CalendarRemindersPanel
            reminders={reminders}
            onDismiss={dismissReminder}
            onSnooze={snoozeReminder}
            onCreate={handleCreateReminder}
          />
        </aside>
      </div>

      <CalendarEventDrawer
        open={drawerOpen}
        mode="edit"
        event={selectedEvent}
        onClose={closeDrawer}
      />
    </div>
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
  onNewEvent,
}: {
  view: CalendarView;
  // Null when the rail is in a mixed state (some teammates hidden,
  // some shown) — neither master tab should appear active in that case.
  scope: CalendarScope | null;
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
  onNewEvent: () => void;
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
          className="ml-1 h-9 rounded-md border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
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
          onClick={onNewEvent}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
        >
          <Plus className="h-3.5 w-3.5" />
          New event
        </button>
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3.5 text-[12.5px] font-medium text-court-fg transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
          />
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
        {/* Passing an empty string here when scope is null means
            neither tab id matches, so both render in the inactive
            style — exactly the "mixed rail" appearance we want. */}
        <TabStrip<CalendarScope>
          ariaLabel="Calendar scope"
          activeId={(scope ?? "") as CalendarScope}
          onChange={onScope}
          items={[
            { id: "me", label: "My Calendar" },
            { id: "team", label: "Team" },
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
