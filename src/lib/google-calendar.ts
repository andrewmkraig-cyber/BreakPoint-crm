import { prisma } from "@/lib/prisma";

// Google Calendar helpers. Reuses the same access-token refresh pattern as
// src/lib/gmail.ts so both APIs share the single Account row per user.
//
// The `https://www.googleapis.com/auth/calendar.events` scope is granted at
// sign-in (see src/lib/auth.ts). Users signed in before the scope was added
// will need to sign out and back in for calendar calls to succeed.

export async function getFreshAccessToken(userId: string): Promise<string> {
  const acct = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
  if (!acct || !acct.refresh_token) {
    throw new Error(
      "No Google refresh token on file. Sign out and sign back in to grant Calendar permissions.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (acct.access_token && acct.expires_at && acct.expires_at - now > 60) {
    return acct.access_token;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: acct.refresh_token,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: { access_token: json.access_token, expires_at: expiresAt },
  });
  return json.access_token;
}

// Google Calendar occasionally returns a transient 403 rateLimitExceeded
// under burst load (e.g. creating both the client + candidate events back
// to back). The request is rejected by quota BEFORE any event is created or
// patched, so re-issuing the identical request cannot double-create — it is
// safe to retry. Andrew hit this as "Some invites didn't send," then a
// manual re-Send (unchanged) succeeded; this wraps that single retry so the
// recruiter doesn't have to. Only a 403 whose body names a rate/quota limit
// is retried (once, after a short backoff); auth/permission 403s pass
// straight through. The original Response is returned untouched so callers
// still read its body via .text()/.json() (we inspect a clone).
const CALENDAR_RATE_LIMIT_RE = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|rate limit exceeded/i;

async function calendarFetch(
  input: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 403 && attempt < 1) {
    const text = await res.clone().text().catch(() => "");
    if (CALENDAR_RATE_LIMIT_RE.test(text)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return calendarFetch(input, init, attempt + 1);
    }
  }
  return res;
}

export type CalendarAttendee = {
  email: string;
  displayName?: string;
  // Google's status enum. Omit to let Google default to "needsAction"
  // for added attendees. Set explicitly when the caller wants the
  // value reflected in the API payload (e.g. the CC field in the
  // calendar create modal).
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
};

export type CreateCalendarEventInput = {
  userId: string;
  summary: string;
  description?: string;
  startISO: string;
  durationMin: number;
  attendees?: CalendarAttendee[];
  // If true, Google creates a Meet conference and returns the link in the
  // response's conferenceData.entryPoints. Only meaningful for video interviews.
  createMeet?: boolean;
  // Attach a PRE-EXISTING Meet to this event instead of creating a new one.
  // Used for the second invite so both the client-only and candidate-only
  // events share the same Meet URL. Pass both the conferenceId and the
  // existing meet link; we rebuild the conferenceData payload.
  attachMeetConferenceId?: string;
  attachMeetLink?: string;
  // Preferred attach path when available: pass the FULL conferenceData
  // payload from the source event (including the server-minted
  // `signature` that Google requires to properly bind the new event
  // to the existing Meet conference). Without signature the Calendar
  // API accepts the payload but Gmail falls back to rendering the
  // Meet as a plain URL in the event body instead of the native
  // "Join with Google Meet" widget. When attachConferenceData is
  // set, attachMeetConferenceId + attachMeetLink are ignored.
  attachConferenceData?: Record<string, unknown>;
  // If false (default), Google will NOT email attendees when the event is
  // created. sendUpdates=true ships the native ICS invite with RSVP buttons.
  sendUpdates?: boolean;
  location?: string;
  // IANA timezone for the event's start/end. Defaults to America/New_York.
  timeZone?: string;
};

export type CreateCalendarEventResult = {
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
  meetingCode: string | null;
};

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CreateCalendarEventResult> {
  const accessToken = await getFreshAccessToken(input.userId);
  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + input.durationMin * 60 * 1000);
  const tz = input.timeZone || "America/New_York";

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    // Guests can pull others in + see the guest list by default. The
    // previous per-event "Open meeting" toggle on the scheduler was
    // retired in favor of the org-wide Google Calendar / Meet setting
    // — Andrew's workspace is now "Open" globally so there is no need
    // to flip this on a per-interview basis.
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true,
    guestsCanModify: false,
  };
  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees.map((a) => {
      const out: Record<string, string> = { email: a.email };
      if (a.displayName) out.displayName = a.displayName;
      if (a.responseStatus) out.responseStatus = a.responseStatus;
      return out;
    });
  }
  if (input.location) body.location = input.location;
  const willAttachExistingMeet =
    Boolean(input.attachConferenceData) ||
    Boolean(input.attachMeetConferenceId && input.attachMeetLink);
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `ace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (input.attachConferenceData) {
    // Preferred: lift the source event's conferenceData verbatim —
    // carries signature + conferenceId + entryPoints + conferenceSolution
    // and binds the new event to the existing Meet conference.
    body.conferenceData = input.attachConferenceData;
  } else if (input.attachMeetConferenceId && input.attachMeetLink) {
    // Legacy / fallback path when we only know the conferenceId + URL.
    // Works as a text link but Gmail may not render the native Meet
    // widget because signature is missing.
    body.conferenceData = {
      conferenceId: input.attachMeetConferenceId,
      conferenceSolutionKey: { type: "hangoutsMeet" },
      entryPoints: [
        { entryPointType: "video", uri: input.attachMeetLink },
      ],
    };
  }

  const sendUpdates = input.sendUpdates ? "all" : "none";
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("sendUpdates", sendUpdates);
  if (input.createMeet || willAttachExistingMeet) url.searchParams.set("conferenceDataVersion", "1");

  const res = await calendarFetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar create failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as {
    id: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: {
      conferenceId?: string;
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  };
  const meetLink = (() => {
    if (json.hangoutLink) return json.hangoutLink;
    const ep = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
    return ep?.uri ?? null;
  })();
  const meetingCode = json.conferenceData?.conferenceId ?? extractMeetCodeFromLink(meetLink);
  return {
    eventId: json.id,
    htmlLink: json.htmlLink ?? null,
    meetLink,
    meetingCode,
  };
}

function extractMeetCodeFromLink(link: string | null): string | null {
  if (!link) return null;
  // Format is https://meet.google.com/abc-defg-hij
  const m = link.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return m?.[1] ?? null;
}

// GETs the source event and returns its conferenceData (or null) so the
// caller can attach the same Meet to a second event. We read the FULL
// payload (signature, conferenceId, entryPoints, conferenceSolution) and
// let the caller pass it through unmodified — anything less and the
// Calendar API treats the new event's Meet as a loose URL reference,
// which is why Gmail renders it as a plain text link.
export async function getEventConferenceData(params: {
  userId: string;
  eventId: string;
}): Promise<Record<string, unknown> | null> {
  const accessToken = await getFreshAccessToken(params.userId);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  const res = await calendarFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar get failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { conferenceData?: Record<string, unknown> };
  return json.conferenceData ?? null;
}

// Patches arbitrary event fields (summary/description/location/attendees/
// time) with caller-controlled sendUpdates. Used by the edit-interview
// flow which needs "notify all" vs "notify new only" semantics.
//
// "notify new only" is implemented by the caller in two passes:
//   1. Patch field changes with sendUpdates="none" (existing attendees
//      see their calendar event silently update — no email).
//   2. Patch the attendee list adding only the new attendees with
//      sendUpdates="all" — Google then emails only the newly added
//      attendees, not the existing ones.
export type PatchCalendarEventDetailsInput = {
  userId: string;
  eventId: string;
  // The calendar the event lives on. Defaults to "primary" for the
  // signed-in user's own events. Shared calendars (e.g. Austin's
  // shared with Andrew) must pass the source calendar id explicitly,
  // since /calendars/primary/events/... only resolves the auth'd
  // user's primary calendar — patching an event on a different
  // calendar through "primary" 404s.
  calendarId?: string;
  sendUpdates: "all" | "none" | "externalOnly";
  startISO?: string;
  durationMin?: number;
  timeZone?: string;
  summary?: string;
  description?: string;
  location?: string | null;
  attendees?: { email: string; displayName?: string }[];
};

export async function patchCalendarEventDetails(
  input: PatchCalendarEventDetailsInput,
): Promise<void> {
  const accessToken = await getFreshAccessToken(input.userId);
  const cal = input.calendarId ?? "primary";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(input.eventId)}`,
  );
  url.searchParams.set("sendUpdates", input.sendUpdates);
  const body: Record<string, unknown> = {};
  if (input.startISO && input.durationMin != null) {
    const start = new Date(input.startISO);
    const end = new Date(start.getTime() + input.durationMin * 60 * 1000);
    const tz = input.timeZone || "America/New_York";
    body.start = { dateTime: start.toISOString(), timeZone: tz };
    body.end = { dateTime: end.toISOString(), timeZone: tz };
  }
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location ?? "";
  if (input.attendees !== undefined) body.attendees = input.attendees;
  if (Object.keys(body).length === 0) return;

  const res = await calendarFetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar patch failed (${res.status}): ${text || "no body"}`);
  }
}

export async function getCalendarEventAttendees(params: {
  userId: string;
  eventId: string;
}): Promise<{ email: string; displayName?: string }[]> {
  const accessToken = await getFreshAccessToken(params.userId);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  const res = await calendarFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar get failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as {
    attendees?: { email?: string; displayName?: string }[];
  };
  return (json.attendees ?? [])
    .filter((a): a is { email: string; displayName?: string } => typeof a.email === "string" && a.email.length > 0)
    .map((a) => ({ email: a.email, displayName: a.displayName }));
}

export async function updateCalendarEvent(params: {
  userId: string;
  eventId: string;
  startISO: string;
  durationMin: number;
  location?: string;
  sendUpdates?: boolean;
  timeZone?: string;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const start = new Date(params.startISO);
  const end = new Date(start.getTime() + params.durationMin * 60 * 1000);
  const tz = params.timeZone || "America/New_York";
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const patchBody: Record<string, unknown> = {
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
  };
  if (params.location !== undefined) patchBody.location = params.location;
  const res = await calendarFetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchBody),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar update failed (${res.status}): ${text || "no body"}`);
  }
}

// Used by the interview invite flow to update a single per-party event:
// append one or more attendees, optionally replace summary/description,
// and let Google send the native invite/update with RSVP buttons.
// Client and candidate invite events are intentionally separate; callers
// choose which event id to patch.
export type UpdateEventAsInviteInput = {
  userId: string;
  eventId: string;
  summary?: string;
  description?: string;
  newAttendees: { email: string; displayName?: string }[];
};

export async function updateEventAsInvite(input: UpdateEventAsInviteInput): Promise<void> {
  const accessToken = await getFreshAccessToken(input.userId);
  const getUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  const getRes = await calendarFetch(getUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!getRes.ok) {
    const text = await getRes.text().catch(() => "");
    throw new Error(`Calendar get failed (${getRes.status}): ${text || "no body"}`);
  }
  const ev = (await getRes.json()) as { attendees?: { email: string; displayName?: string }[] };
  const existing = ev.attendees ?? [];
  const seen = new Set(existing.map((a) => (a.email ?? "").toLowerCase()));
  const next = [...existing];
  let added = 0;
  for (const a of input.newAttendees) {
    const key = (a.email ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({ email: a.email, displayName: a.displayName });
    added += 1;
  }

  const patchBody: Record<string, unknown> = { attendees: next };
  if (input.summary !== undefined) patchBody.summary = input.summary;
  if (input.description !== undefined) patchBody.description = input.description;

  // Nothing to write — no new attendees AND no header changes. Avoid a
  // no-op PATCH that would still mail every existing attendee a
  // pointless "updated" notification.
  if (added === 0 && input.summary === undefined && input.description === undefined) {
    return;
  }

  const patchUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  patchUrl.searchParams.set("sendUpdates", "all");
  const patchRes = await calendarFetch(patchUrl.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchBody),
    cache: "no-store",
  });
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => "");
    throw new Error(`Calendar patch failed (${patchRes.status}): ${text || "no body"}`);
  }
}

export type AddAttendeeInput = {
  userId: string;
  eventId: string;
  attendee: { email: string; displayName?: string };
  sendUpdates?: boolean;
};

// Appends an attendee to an existing event. Google's PATCH replaces the
// attendees array wholesale, so we GET first, merge, then PATCH. If the
// attendee is already on the event (by email), the PATCH is a no-op.
export async function addAttendeeToEvent(input: AddAttendeeInput): Promise<void> {
  const accessToken = await getFreshAccessToken(input.userId);
  const getUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  const getRes = await calendarFetch(getUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!getRes.ok) {
    const text = await getRes.text().catch(() => "");
    throw new Error(`Calendar get failed (${getRes.status}): ${text || "no body"}`);
  }
  const ev = (await getRes.json()) as { attendees?: { email: string; displayName?: string }[] };
  const existing = ev.attendees ?? [];
  if (existing.some((a) => (a.email ?? "").toLowerCase() === input.attendee.email.toLowerCase())) {
    return;
  }
  const next = [...existing, { email: input.attendee.email, displayName: input.attendee.displayName }];

  const sendUpdates = input.sendUpdates ? "all" : "none";
  const patchUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  patchUrl.searchParams.set("sendUpdates", sendUpdates);
  const patchRes = await calendarFetch(patchUrl.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attendees: next }),
    cache: "no-store",
  });
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => "");
    throw new Error(`Calendar patch failed (${patchRes.status}): ${text || "no body"}`);
  }
}

export async function deleteCalendarEvent(params: {
  userId: string;
  eventId: string;
  calendarId?: string;
  sendUpdates?: boolean;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const cal = params.calendarId ?? "primary";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const res = await calendarFetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar delete failed (${res.status}): ${text || "no body"}`);
  }
}
