"use client";

import { useEffect } from "react";

import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import {
  useCalendarDrawer,
  type CalendarDrawerCandidatePrefill,
} from "@/lib/calendar-drawer-context";

// Mounted once in providers so create can render as an overlay on
// any route. Also catches the cross-tree `ace:calendar:new-event` and
// `ace:calendar:new-reminder` dispatches that the global TopBar
// button fires — previously these died silently outside /calendar
// because only calendar-view subscribed.
export function GlobalCalendarDrawer() {
  const { isOpen, prefill, prefillType, prefillCandidate, open, close } =
    useCalendarDrawer();

  useEffect(() => {
    const onNewEvent = (event: Event) => {
      const candidate =
        event instanceof CustomEvent
          ? (event.detail as { candidate?: CalendarDrawerCandidatePrefill | null })
              ?.candidate
          : null;
      open({ candidate: candidate ?? null });
    };
    const onNewReminder = () => open({ type: "reminder" });
    window.addEventListener("ace:calendar:new-event", onNewEvent);
    window.addEventListener("ace:calendar:new-reminder", onNewReminder);
    return () => {
      window.removeEventListener("ace:calendar:new-event", onNewEvent);
      window.removeEventListener("ace:calendar:new-reminder", onNewReminder);
    };
  }, [open]);

  return (
    <CalendarEventDrawer
      open={isOpen}
      mode="create"
      event={null}
      prefill={prefill}
      prefillType={prefillType}
      prefillCandidate={prefillCandidate}
      onClose={close}
    />
  );
}
