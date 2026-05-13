import type {
  CalendarEvent,
  CalendarReminder,
  CalendarTeamMember,
} from "@/lib/calendar/types";

// Stub events / reminders for the calendar UI. Database persistence
// lands in a follow-up. Until then the page renders against this
// fixture so the screens are real and verifiable in a browser.
//
// Anchored to the week of Mon May 11 to Sun May 17 2026 (Andrew's
// current dev date). "Today" is Tue May 12, 10:42 AM.

export const SAMPLE_TEAM: CalendarTeamMember[] = [
  { id: "ak", name: "Andrew Kraig", initials: "AK", color: "#5A9642", self: true },
  { id: "rc", name: "Rachel Cole", initials: "RC", color: "#1E40AF" },
  { id: "mw", name: "Marcus Webb", initials: "MW", color: "#92400E" },
  { id: "es", name: "Elena Soto", initials: "ES", color: "#7C3AED" },
  { id: "jt", name: "Jordan Tate", initials: "JT", color: "#DB2777" },
];

// Em dashes from the design have been swapped for en dashes per the
// no-em-dash project rule.
export const SAMPLE_EVENTS: CalendarEvent[] = [
  // Mon May 11
  {
    id: "e1",
    day: 0,
    start: 9.0,
    end: 10.0,
    type: "interview",
    title: "Sarah Chen – Senior Tax Manager",
    meta: "Round 2 · Heat and Control",
    ownerId: "ak",
    guests: ["Sarah Chen", "Leslie Park"],
    where: "Google Meet",
    job: "Senior Tax Manager",
    candidate: "Sarah Chen",
  },
  {
    id: "e2",
    day: 0,
    start: 11.5,
    end: 12.5,
    type: "client",
    title: "Heat and Control intake",
    meta: "Leslie Park",
    ownerId: "ak",
    guests: ["Leslie Park"],
    where: "Zoom",
  },
  {
    id: "e3",
    day: 0,
    start: 15.0,
    end: 16.0,
    type: "other",
    title: "Weekly desk sync",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC", "MW"],
    where: "Office",
  },

  // Tue May 12 (today)
  {
    id: "e4",
    day: 1,
    start: 8.0,
    end: 9.0,
    type: "personal",
    title: "Gym",
    meta: "Reminder",
    ownerId: "ak",
    guests: [],
    where: "",
  },
  {
    id: "e5",
    day: 1,
    start: 10.0,
    end: 11.0,
    type: "interview",
    title: "Marcus Reed – Controller",
    meta: "Final · Capstone Accounting",
    ownerId: "ak",
    guests: ["Marcus Reed", "Diana Wu"],
    where: "Google Meet",
    job: "Controller",
    candidate: "Marcus Reed",
  },
  {
    id: "e6",
    day: 1,
    start: 13.0,
    end: 14.0,
    type: "client",
    title: "Capstone Accounting catch-up",
    meta: "Diana Wu",
    ownerId: "ak",
    guests: ["Diana Wu"],
    where: "Phone",
  },
  {
    id: "e7",
    day: 1,
    start: 16.5,
    end: 17.5,
    type: "interview",
    title: "Priya Singh – Senior Tax Manager",
    meta: "Screen · Heat and Control",
    ownerId: "ak",
    guests: ["Priya Singh"],
    where: "Google Meet",
  },

  // Wed May 13
  {
    id: "e8",
    day: 2,
    start: 9.5,
    end: 10.5,
    type: "client",
    title: "Lakefront Partners weekly",
    meta: "Greg Halverson",
    ownerId: "rc",
    guests: ["Greg Halverson"],
    where: "Zoom",
  },
  {
    id: "e9",
    day: 2,
    start: 11.0,
    end: 12.0,
    type: "interview",
    title: "Daniel Cho – FP&A Manager",
    meta: "Round 1 · Lakefront",
    ownerId: "ak",
    guests: ["Daniel Cho", "Greg Halverson"],
    where: "Google Meet",
  },
  {
    id: "e10",
    day: 2,
    start: 14.0,
    end: 15.0,
    type: "other",
    title: "Pipeline review",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC"],
    where: "Office",
  },
  {
    id: "e11",
    day: 2,
    start: 17.0,
    end: 18.0,
    type: "personal",
    title: "Pick up dry cleaning",
    meta: "Reminder",
    ownerId: "ak",
    guests: [],
    where: "",
  },

  // Thu May 14
  {
    id: "e12",
    day: 3,
    start: 10.0,
    end: 11.0,
    type: "interview",
    title: "Anna Volkov – Staff Accountant",
    meta: "Screen · Rust Belt Logistics",
    ownerId: "mw",
    guests: ["Anna Volkov", "Pete Doyle"],
    where: "Google Meet",
  },
  {
    id: "e13",
    day: 3,
    start: 12.0,
    end: 13.0,
    type: "personal",
    title: "Lunch w/ Kevin",
    meta: "Reminder",
    ownerId: "ak",
    guests: ["Kevin"],
    where: "Soho House",
  },
  {
    id: "e14",
    day: 3,
    start: 15.5,
    end: 16.5,
    type: "client",
    title: "Rust Belt Logistics weekly",
    meta: "Pete Doyle",
    ownerId: "ak",
    guests: ["Pete Doyle"],
    where: "Zoom",
  },

  // Fri May 15
  {
    id: "e15",
    day: 4,
    start: 9.0,
    end: 10.0,
    type: "interview",
    title: "Jamal Wright – Senior Auditor",
    meta: "Final · Avon Lake Capital",
    ownerId: "ak",
    guests: ["Jamal Wright", "Reed Marin"],
    where: "Google Meet",
  },
  {
    id: "e16",
    day: 4,
    start: 13.0,
    end: 14.0,
    type: "other",
    title: "End of week wrap",
    meta: "Internal",
    ownerId: "ak",
    guests: ["AK", "RC", "MW", "ES"],
    where: "Office",
  },
];

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

// Work-week view: Mon–Fri only. The week navigation buttons still
// advance by 7 calendar days, but Saturday and Sunday are not shown
// as columns. Events with day index 5 or 6 (legacy weekend rows) will
// be filtered out of the week + month grids — none currently exist.
export const WEEK_DAYS = [
  { key: "mon", label: "Mon", date: 11 },
  { key: "tue", label: "Tue", date: 12 },
  { key: "wed", label: "Wed", date: 13 },
  { key: "thu", label: "Thu", date: 14 },
  { key: "fri", label: "Fri", date: 15 },
] as const;

export const MONTH_NAME = "May";
export const YEAR = 2026;
// Tue May 12, 2026, 10:42 AM. Drives the now-line + greeting.
export const TODAY_INDEX = 1;
export const NOW_HOUR = 10;
export const NOW_MIN = 42;
