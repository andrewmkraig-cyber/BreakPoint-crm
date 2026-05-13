// Calendar event + reminder shape. Plain values so the same record
// crosses the server/client boundary unchanged. startTime/endTime are
// real Date objects so the grid math, navigation, and the upcoming
// Google Calendar sync all share one canonical time representation.

export type CalendarEventType = "interview" | "client" | "reminder" | "other";

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
  ownerId?: string;
  jobId?: string;
  candidateId?: string;
  clientId?: string;
  calendarName?: string;
  calendarColor?: string;
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
