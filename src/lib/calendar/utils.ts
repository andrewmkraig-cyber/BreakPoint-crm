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
// `count` is how many tiles share the overlap cluster (1 = the tile owns
// the full column width); `index` is this tile's 0-based slot from the
// left. Two interviews at the same time end up as {index:0,count:2} and
// {index:1,count:2} so they render side-by-side instead of stacked. A
// reminder sharing a slot with an event falls out of the same math (the
// reminder biases to the right column - see the sort below).
export type EventColumn = { index: number; count: number };

type LaneInput = {
  id: string;
  type: CalendarEventType;
  startTime: Date;
  endTime: Date;
  allDay?: boolean;
};

// Pack overlapping timed tiles into side-by-side columns. Two events that
// share any time span split the column so neither covers the other -
// generalizing the old reminder-only left/right split to any number of
// overlapping tiles (the candidate + client interview events are the
// driving case). All-day tiles are excluded from packing entirely: they
// span the whole grid and must NOT shove timed events into narrow columns.
//
// Standard interval-graph sweep: sort by start, grow a cluster while the
// next tile starts before the running cluster end, then greedily place
// each tile in the first column whose previous occupant has ended.
export function computeEventColumns(
  dayEvents: LaneInput[],
): Map<string, EventColumn> {
  const result = new Map<string, EventColumn>();
  const FULL: EventColumn = { index: 0, count: 1 };

  // All-day tiles never participate; they keep the full width.
  const timed = dayEvents.filter((e) => !e.allDay);
  for (const e of dayEvents) {
    if (e.allDay) result.set(e.id, FULL);
  }

  // Sort by start asc; at equal starts put reminders last so a reminder
  // sharing a slot with an event lands in the right-hand column (matches
  // the prior reminder-to-the-right look). Then end asc, then id for a
  // stable order across renders.
  const sorted = [...timed].sort((a, b) => {
    const s = a.startTime.getTime() - b.startTime.getTime();
    if (s !== 0) return s;
    const ar = a.type === "reminder" ? 1 : 0;
    const br = b.type === "reminder" ? 1 : 0;
    if (ar !== br) return ar - br;
    const e = a.endTime.getTime() - b.endTime.getTime();
    if (e !== 0) return e;
    return a.id.localeCompare(b.id);
  });

  let i = 0;
  while (i < sorted.length) {
    const cluster: LaneInput[] = [sorted[i]];
    let clusterEnd = sorted[i].endTime.getTime();
    let j = i + 1;
    while (j < sorted.length && sorted[j].startTime.getTime() < clusterEnd) {
      cluster.push(sorted[j]);
      clusterEnd = Math.max(clusterEnd, sorted[j].endTime.getTime());
      j++;
    }
    // Greedy column assignment within the cluster.
    const colEnd: number[] = [];
    const colOf = new Map<string, number>();
    for (const ev of cluster) {
      let placed = colEnd.findIndex((end) => end <= ev.startTime.getTime());
      if (placed === -1) {
        placed = colEnd.length;
        colEnd.push(ev.endTime.getTime());
      } else {
        colEnd[placed] = ev.endTime.getTime();
      }
      colOf.set(ev.id, placed);
    }
    const count = colEnd.length;
    for (const ev of cluster) {
      result.set(ev.id, { index: colOf.get(ev.id) ?? 0, count });
    }
    i = j;
  }
  return result;
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
