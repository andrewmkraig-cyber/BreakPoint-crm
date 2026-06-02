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
  // Set when this block is a standalone Ace reminder rendered on the
  // grid/widget as a pseudo-event (not a real Google CalendarEvent).
  // Clicking it opens the reminders panel editor, not the Google drawer.
  aceReminderId?: string;
  // Notification leads carried on the reminder pseudo-event so a click on
  // a PAST or beyond-top-10 reminder (which isn't in the panel's Upcoming
  // list) can still seed a complete editor instead of silently doing
  // nothing. Only set alongside aceReminderId.
  reminderLeadsMin?: number[];
  // Interview restructure D1. Set when this calendar block belongs to an
  // Ace Interview row (mapped via the googleEventId → Interview.id pattern).
  // Drives the drawer's interview-aware Edit / Cancel and the stored
  // "what the recipient saw" detail.
  interviewId?: string;
  // Which party's invite this block represents: "candidate" / "client" for
  // a sent per-party event, "none" for the organizer-only tracking event
  // ("client will send invites", nothing emailed by us).
  interviewParty?: "candidate" | "client" | "none";
  // The exact subject + body this party was emailed, copied at send time.
  // Rendered in the drawer for parity with the real Google invite. Absent
  // for the tracking-event ("none") case where no invite went out.
  sentSubject?: string;
  sentBody?: string;
};

export type CalendarReminder = {
  id: string;
  title: string;
  // Authoritative time the reminder is due. The Date itself is the
  // source of truth for "has it passed?" - `when`/`abs` are rendered
  // labels that fall behind real time but never drive logic.
  reminderAt: Date;
  when: string;
  abs: string;
  source: string;
  urgent?: boolean;
  // Minutes-before-anchor notification leads (e.g. [15] or [15, 60]).
  // Edited in the reminders panel; default standard is a single 15.
  notifyLeadsMin: number[];
};

export type CalendarTeamMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
  self?: boolean;
  // URL to the member's profile picture (uploaded /api/avatar/<id>
  // path or their Google OAuth photo). Null when the user has
  // neither uploaded a picture nor signed in via Google. Drives the
  // avatar render in the calendar team list and on event-tile owner
  // dots — when present, the initials fall back to a small overlay.
  image?: string | null;
};

export type CalendarView = "day" | "week" | "month";
export type CalendarScope = "me" | "team";
