// Calendar event + reminder shape. Plain values so the same record
// crosses the server/client boundary unchanged. startTime/endTime are
// real Date objects so the grid math, navigation, and the upcoming
// Google Calendar sync all share one canonical time representation.

export type CalendarEventType = "interview" | "client" | "personal" | "other";

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
};

export type CalendarReminder = {
  id: string;
  when: string;
  abs: string;
  title: string;
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
