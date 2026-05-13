// Calendar event + reminder shape. Plain values so the same record
// crosses the server/client boundary unchanged. startTime/endTime are
// real Date objects so the grid math, navigation, and the upcoming
// Google Calendar sync all share one canonical time representation.

export type CalendarEventType =
  | "interview"
  | "client"
  | "candidate"
  | "reminder"
  | "other";

export type CalendarEvent = {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  allDay?: boolean;
  type: CalendarEventType;
  meta?: string;
  guests?: string[];
  location?: string;
  // Normalized owner keys for this event. An event that lives on both
  // Andrew's and Austin's calendars (same googleEventId, different
  // calendarId rows) gets merged into one CalendarEvent with both
  // keys in this array — so a single block appears on the grid and
  // both team-toggle checkboxes can hide it.
  ownerKeys: string[];
  jobId?: string;
  candidateId?: string;
  clientId?: string;
  calendarName?: string;
  calendarColor?: string;
  // Video-conference URL surfaced from Google (hangoutLink or
  // conferenceData.entryPoints). Rendered as a clickable link in the
  // drawer's Location field when present.
  meetLink?: string;
  // Google's own canonical URL for the event. Used as the
  // "Open in Google Calendar" bridge in the drawer header.
  htmlLink?: string;
  // True when an undismissed AceReminder is linked to this event.
  // Drives the "Ace reminder" toggle in the drawer.
  reminderEnabled?: boolean;
};

export type CalendarReminder = {
  id: string;
  title: string;
  // Authoritative time the reminder is due. The Date itself is the
  // source of truth for "has it passed?" — `when`/`abs` are rendered
  // labels that fall behind real time but never drive logic.
  reminderAt: Date;
  when: string;
  abs: string;
  source: string;
  urgent?: boolean;
};

export type CalendarTeamMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
  self?: boolean;
};

export type CalendarView = "day" | "week" | "month";
export type CalendarScope = "me" | "team";
