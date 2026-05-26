import type { CalendarEventType } from "@/lib/calendar/types";
import { decimalHour } from "@/lib/calendar/week";

// Each slot is 56px tall and the grid starts at midnight. Same
// constant the week / day views all reference, so the now-line and
// event positions stay aligned even if the start hour changes. The
// grid covers the full 24 hours; views scroll internally to whichever
// hour the recruiter is looking at (defaulting to ~7 AM on mount).
export const SLOT_HEIGHT = 56;
export const GRID_START_HOUR = 0;

export function hourToY(h: number): number {
  return (h - GRID_START_HOUR) * SLOT_HEIGHT;
}

export function fmtHour(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const ampm = whole >= 12 ? "PM" : "AM";
  const hh = ((whole + 11) % 12) + 1;
  return mins === 0
    ? `${hh} ${ampm}`
    : `${hh}:${String(mins).padStart(2, "0")} ${ampm}`;
}

export function fmtRange(start: number, end: number): string {
  return `${fmtHour(start)} – ${fmtHour(end)}`;
}

// Date-shaped variants. The grid math still flows through decimal
// hours, but consumers can format a Date directly without converting
// at every call site.
export function fmtTime(d: Date): string {
  return fmtHour(decimalHour(d));
}

export function fmtDateRange(start: Date, end: Date): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

// Event-type display tokens. Brand green now belongs to Client Call
// (Andrew's bread-and-butter outbound). Interviews moved to blue,
// Candidate Calls land in yellow, Reminders stay amber, Other stays
// slate. Tailwind palette tokens are used through the returned class
// strings so we don't bake hex values into components.
export type EventTypeMeta = {
  label: string;
  dot: string;
  // Tailwind class string applied to the event pill in week / day
  // views. Border + background + text + dark-mode equivalents.
  pillClass: string;
  // Tailwind class string for the small uppercase "Interview" /
  // "Client Call" chip used inside day-view event headers.
  chipClass: string;
};

// Sub-column placement for an event tile inside a single day column.
// "full" keeps the whole width; "left" / "right" split the column when
// a reminder shares a time slot with a real calendar event so neither
// sits on top of the other.
export type CalendarLane = "full" | "left" | "right";

type LaneInput = {
  id: string;
  type: CalendarEventType;
  startTime: Date;
  endTime: Date;
};

function intervalsOverlap(a: LaneInput, b: LaneInput): boolean {
  return (
    a.startTime.getTime() < b.endTime.getTime() &&
    b.startTime.getTime() < a.endTime.getTime()
  );
}

// Reminder/event collisions only - general event/event overlap is left
// as-is. A reminder that overlaps any real event drops into the right
// lane; the events it overlaps drop into the left lane. Everything else
// stays full width.
export function computeReminderLanes(
  dayEvents: LaneInput[],
): Map<string, CalendarLane> {
  const lanes = new Map<string, CalendarLane>();
  const reminders = dayEvents.filter((e) => e.type === "reminder");
  const others = dayEvents.filter((e) => e.type !== "reminder");
  for (const r of reminders) {
    lanes.set(r.id, others.some((o) => intervalsOverlap(r, o)) ? "right" : "full");
  }
  for (const o of others) {
    lanes.set(o.id, reminders.some((r) => intervalsOverlap(o, r)) ? "left" : "full");
  }
  return lanes;
}

export function eventTypeMeta(t: CalendarEventType): EventTypeMeta {
  switch (t) {
    case "interview":
      return {
        label: "Interview",
        dot: "#1E40AF",
        pillClass:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
        chipClass:
          "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
      };
    case "client":
      return {
        label: "Client Call",
        dot: "#5A9642",
        pillClass:
          "bg-court-brand-tint text-court-brand-dark border-court-brand/40 dark:bg-court-brand-tint dark:text-court-brand-dark",
        chipClass:
          "bg-court-brand-tint text-court-brand-dark border border-court-brand/30",
      };
    case "candidate":
      return {
        label: "Candidate Call",
        dot: "#CA8A04",
        pillClass:
          "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
        chipClass:
          "bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
      };
    case "reminder":
      return {
        label: "Reminder",
        dot: "#D97706",
        pillClass:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
        chipClass:
          "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
      };
    default:
      return {
        label: "Other",
        dot: "#6B7280",
        pillClass:
          "bg-court-surface-subtle text-court-fg-muted border-court-border",
        chipClass:
          "bg-court-surface-subtle text-court-fg-muted border border-court-border",
      };
  }
}
