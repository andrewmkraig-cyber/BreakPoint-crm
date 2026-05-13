import type { CalendarEventType } from "@/lib/calendar/types";
import { decimalHour } from "@/lib/calendar/week";

// Each slot is 56px tall and the grid starts at 7 AM. Same constant
// the week / day views all reference, so the now-line and event
// positions stay aligned even if the start hour changes.
export const SLOT_HEIGHT = 56;
export const GRID_START_HOUR = 7;

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

// Event-type display tokens. Brand green is allowed per the project
// rule; the other three palettes are semantic (blue=client, amber=
// reminder, slate=other) and use Tailwind palette tokens through the
// returned class strings so we don't bake hex values into components.
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

export function eventTypeMeta(t: CalendarEventType): EventTypeMeta {
  switch (t) {
    case "interview":
      return {
        label: "Interview",
        dot: "#5A9642",
        pillClass:
          "bg-court-brand-tint text-court-brand-dark border-court-brand/40 dark:bg-court-brand-tint dark:text-court-brand-dark",
        chipClass:
          "bg-court-brand-tint text-court-brand-dark border border-court-brand/30",
      };
    case "client":
      return {
        label: "Client Call",
        dot: "#1E40AF",
        pillClass:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
        chipClass:
          "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
      };
    case "personal":
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
