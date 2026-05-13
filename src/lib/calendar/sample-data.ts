import type {
  CalendarEvent,
  CalendarReminder,
  CalendarTeamMember,
} from "@/lib/calendar/types";
import { addDays, getMondayOfWeek } from "@/lib/calendar/week";

// Stub events / reminders for the calendar UI. Database persistence
// lands in a follow-up; until then the page renders against these
// generators so the screens are real and verifiable in a browser.
//
// getSampleEvents() anchors against the caller-supplied "today" Date
// (passed in from the page server component to keep SSR and CSR
// deterministic) and spreads events across Mon–Fri of that week.
// Navigating to a different week therefore shows an empty grid, which
// is the intended way to verify prev/next works.

export const SAMPLE_TEAM: CalendarTeamMember[] = [
  { id: "ak", name: "Andrew Kraig", initials: "AK", color: "#5A9642", self: true },
  { id: "rc", name: "Rachel Cole", initials: "RC", color: "#1E40AF" },
  { id: "mw", name: "Marcus Webb", initials: "MW", color: "#92400E" },
  { id: "es", name: "Elena Soto", initials: "ES", color: "#7C3AED" },
  { id: "jt", name: "Jordan Tate", initials: "JT", color: "#DB2777" },
];

type SeedEntry = {
  id: string;
  dayOffset: number; // 0 = Mon, 4 = Fri
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  type: CalendarEvent["type"];
  title: string;
  meta?: string;
  ownerId?: string;
  guests?: string[];
  location?: string;
};

const SEED: SeedEntry[] = [
  // Mon
  {
    id: "e1",
    dayOffset: 0,
    startHour: 9,
    startMinute: 0,
    endHour: 10,
    endMinute: 0,
    type: "interview",
    title: "Sarah Chen – Senior Tax Manager",
    meta: "Round 2 · Heat and Control",
    ownerId: "ak",
    guests: ["Sarah Chen", "Leslie Park"],
    location: "Google Meet",
  },
  {
    id: "e2",
    dayOffset: 0,
    startHour: 11,
    startMinute: 30,
    endHour: 12,
    endMinute: 30,
    type: "client",
    title: "Heat and Control intake",
    meta: "Leslie Park",
    ownerId: "ak",
    guests: ["Leslie Park"],
    location: "Zoom",
  },
  {
    id: "e3",
    dayOffset: 0,
    startHour: 15,
    startMinute: 0,
    endHour: 16,
    endMinute: 0,
    type: "other",
    title: "Weekly desk sync",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC", "MW"],
    location: "Office",
  },
  // Tue
  {
    id: "e4",
    dayOffset: 1,
    startHour: 8,
    startMinute: 0,
    endHour: 9,
    endMinute: 0,
    type: "personal",
    title: "Gym",
    meta: "Reminder",
    ownerId: "ak",
  },
  {
    id: "e5",
    dayOffset: 1,
    startHour: 10,
    startMinute: 0,
    endHour: 11,
    endMinute: 0,
    type: "interview",
    title: "Marcus Reed – Controller",
    meta: "Final · Capstone Accounting",
    ownerId: "ak",
    guests: ["Marcus Reed", "Diana Wu"],
    location: "Google Meet",
  },
  {
    id: "e6",
    dayOffset: 1,
    startHour: 13,
    startMinute: 0,
    endHour: 14,
    endMinute: 0,
    type: "client",
    title: "Capstone Accounting catch-up",
    meta: "Diana Wu",
    ownerId: "ak",
    guests: ["Diana Wu"],
    location: "Phone",
  },
  {
    id: "e7",
    dayOffset: 1,
    startHour: 16,
    startMinute: 30,
    endHour: 17,
    endMinute: 30,
    type: "interview",
    title: "Priya Singh – Senior Tax Manager",
    meta: "Screen · Heat and Control",
    ownerId: "ak",
    guests: ["Priya Singh"],
    location: "Google Meet",
  },
  // Wed
  {
    id: "e8",
    dayOffset: 2,
    startHour: 9,
    startMinute: 30,
    endHour: 10,
    endMinute: 30,
    type: "client",
    title: "Lakefront Partners weekly",
    meta: "Greg Halverson",
    ownerId: "rc",
    guests: ["Greg Halverson"],
    location: "Zoom",
  },
  {
    id: "e9",
    dayOffset: 2,
    startHour: 11,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    type: "interview",
    title: "Daniel Cho – FP&A Manager",
    meta: "Round 1 · Lakefront",
    ownerId: "ak",
    guests: ["Daniel Cho", "Greg Halverson"],
    location: "Google Meet",
  },
  {
    id: "e10",
    dayOffset: 2,
    startHour: 14,
    startMinute: 0,
    endHour: 15,
    endMinute: 0,
    type: "other",
    title: "Pipeline review",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC"],
    location: "Office",
  },
  {
    id: "e11",
    dayOffset: 2,
    startHour: 17,
    startMinute: 0,
    endHour: 18,
    endMinute: 0,
    type: "personal",
    title: "Pick up dry cleaning",
    meta: "Reminder",
    ownerId: "ak",
  },
  // Thu
  {
    id: "e12",
    dayOffset: 3,
    startHour: 10,
    startMinute: 0,
    endHour: 11,
    endMinute: 0,
    type: "interview",
    title: "Anna Volkov – Staff Accountant",
    meta: "Screen · Rust Belt Logistics",
    ownerId: "mw",
    guests: ["Anna Volkov", "Pete Doyle"],
    location: "Google Meet",
  },
  {
    id: "e13",
    dayOffset: 3,
    startHour: 12,
    startMinute: 0,
    endHour: 13,
    endMinute: 0,
    type: "personal",
    title: "Lunch w/ Kevin",
    meta: "Reminder",
    ownerId: "ak",
    guests: ["Kevin"],
    location: "Soho House",
  },
  {
    id: "e14",
    dayOffset: 3,
    startHour: 15,
    startMinute: 30,
    endHour: 16,
    endMinute: 30,
    type: "client",
    title: "Rust Belt Logistics weekly",
    meta: "Pete Doyle",
    ownerId: "ak",
    guests: ["Pete Doyle"],
    location: "Zoom",
  },
  // Fri
  {
    id: "e15",
    dayOffset: 4,
    startHour: 9,
    startMinute: 0,
    endHour: 10,
    endMinute: 0,
    type: "interview",
    title: "Jamal Wright – Senior Auditor",
    meta: "Final · Avon Lake Capital",
    ownerId: "ak",
    guests: ["Jamal Wright", "Reed Marin"],
    location: "Google Meet",
  },
  {
    id: "e16",
    dayOffset: 4,
    startHour: 13,
    startMinute: 0,
    endHour: 14,
    endMinute: 0,
    type: "other",
    title: "End of week wrap",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC", "MW", "ES"],
    location: "Office",
  },
];

// Builds the seed events anchored to the work week containing `anchor`.
// Times are interpreted in local time of the caller.
export function getSampleEvents(anchor: Date): CalendarEvent[] {
  const monday = getMondayOfWeek(anchor);
  return SEED.map((s) => {
    const day = addDays(monday, s.dayOffset);
    const startTime = new Date(day);
    startTime.setHours(s.startHour, s.startMinute, 0, 0);
    const endTime = new Date(day);
    endTime.setHours(s.endHour, s.endMinute, 0, 0);
    return {
      id: s.id,
      title: s.title,
      startTime,
      endTime,
      type: s.type,
      meta: s.meta,
      ownerId: s.ownerId,
      guests: s.guests,
      location: s.location,
    };
  });
}

// Reminders are Ace-native only: they fire as toasts inside Ace and
// never push to Google Calendar. Mirroring the rule from the design's
// reminders panel header.
export const SAMPLE_REMINDERS: CalendarReminder[] = [
  {
    id: "r1",
    when: "Today · 1:45 PM",
    abs: "Tue May 12 · 1:45 PM",
    title: "Send Marcus the offer letter draft",
    source: "Manual",
    urgent: true,
  },
  {
    id: "r2",
    when: "Tomorrow · 9:00 AM",
    abs: "Wed May 13 · 9:00 AM",
    title: "Call Diana about Capstone budget",
    source: "From event",
  },
  {
    id: "r3",
    when: "Fri May 15 · 11:00 AM",
    abs: "Fri May 15 · 11:00 AM",
    title: "Renew Quo subscription",
    source: "Manual",
  },
  {
    id: "r4",
    when: "Jun 1 · 9:00 AM",
    abs: "Mon Jun 1 · 9:00 AM",
    title: "Cancel Adobe subscription",
    source: "Manual",
  },
  {
    id: "r5",
    when: "Jun 4 · 8:30 AM",
    abs: "Thu Jun 4 · 8:30 AM",
    title: "Submit Q2 placement report",
    source: "Manual",
  },
];
