// Calendar event + reminder shape. Plain values so the same record
// crosses the server/client boundary unchanged. The data layer will
// land in a follow-up; this session ships the UI off sample data.

export type CalendarEventType = "interview" | "client" | "personal" | "other";

export type CalendarEvent = {
  id: string;
  // 0..6, Mon-first to match the design's week grid.
  day: number;
  // Decimal-hour start / end (9.5 = 9:30 AM). Keeps slot math one line.
  start: number;
  end: number;
  type: CalendarEventType;
  title: string;
  meta: string;
  ownerId: string;
  guests: string[];
  where: string;
  job?: string;
  candidate?: string;
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
