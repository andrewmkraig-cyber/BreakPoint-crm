"use client";

import { useEffect } from "react";

import { CalendarEventDrawer } from "@/components/calendar/event-drawer";
import { useCalendarDrawer } from "@/lib/calendar-drawer-context";

// Mounted once in providers so create can render as an overlay on
// any route. Also catches the cross-tree `ace:calendar:new-event` and
// `ace:calendar:new-reminder` dispatches that the global TopBar
// button fires — previously these died silently outside /calendar
// because only calendar-view subscribed.
export function GlobalCalendarDrawer() {
  const { isOpen, prefill, prefillType, open, close } = useCalendarDrawer();

  useEffect(() => {
    const onNewEvent = () => open();
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
      onClose={close}
    />
  );
}
