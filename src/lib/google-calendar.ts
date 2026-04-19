import { prisma } from "@/lib/prisma";

// Google Calendar helpers. Reuses the same access-token refresh pattern as
// src/lib/gmail.ts so both APIs share the single Account row per user.
//
// The `https://www.googleapis.com/auth/calendar.events` scope is granted at
// sign-in (see src/lib/auth.ts). Users signed in before the scope was added
// will need to sign out and back in for calendar calls to succeed.

async function getFreshAccessToken(userId: string): Promise<string> {
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

export type CalendarAttendee = { email: string; displayName?: string };

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
  // If false (default), Google will NOT email attendees when the event is
  // created. sendUpdates=true ships the native ICS invite with RSVP buttons.
  sendUpdates?: boolean;
  location?: string;
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
  const tz = "America/New_York";

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    // Guest controls: invitees can invite others + see the guest list, but
    // can't move/edit the event. Matches the "everyone knows who's on the
    // call" default the recruiter expects.
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true,
    guestsCanModify: false,
  };
  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees.map((a) => ({ email: a.email, displayName: a.displayName }));
  }
  if (input.location) body.location = input.location;
  const willAttachExistingMeet = Boolean(input.attachMeetConferenceId && input.attachMeetLink);
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `ace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (willAttachExistingMeet) {
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

  const res = await fetch(url.toString(), {
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

// Sets the Meet space's access type to OPEN so anyone with the link can
// join without a host letting them in. Needs the
// `https://www.googleapis.com/auth/meetings.space.settings` OAuth scope
// (see src/lib/auth.ts). Fails soft: if the call errors (missing scope,
// API not enabled, etc.) we return the error so the caller can log it,
// but the calendar event is already created either way.
export async function setMeetOpenAccess(params: {
  userId: string;
  meetingCode: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const accessToken = await getFreshAccessToken(params.userId);
    const url = new URL(
      `https://meet.googleapis.com/v2beta/spaces/${encodeURIComponent(params.meetingCode)}`,
    );
    url.searchParams.set("updateMask", "config.accessType");
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ config: { accessType: "OPEN" } }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Meet spaces.patch ${res.status}: ${text.slice(0, 300) || "no body"}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function updateCalendarEvent(params: {
  userId: string;
  eventId: string;
  startISO: string;
  durationMin: number;
  sendUpdates?: boolean;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const start = new Date(params.startISO);
  const end = new Date(start.getTime() + params.durationMin * 60 * 1000);
  const tz = "America/New_York";
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar update failed (${res.status}): ${text || "no body"}`);
  }
}

// Used by the two-step interview invite flow: PATCH the event to update
// summary (= composer subject) + description (= composer body) and APPEND
// a new attendee. sendUpdates="all" so Google emails the native invite
// with ICS attachment to the attendee — they get Accept / Maybe / Decline
// buttons native to Gmail / iCal / whatever client they use, not a
// second free-form email.
export type UpdateEventAsInviteInput = {
  userId: string;
  eventId: string;
  summary: string;
  description: string;
  newAttendee: { email: string; displayName?: string };
};

export async function updateEventAsInvite(input: UpdateEventAsInviteInput): Promise<void> {
  const accessToken = await getFreshAccessToken(input.userId);
  const getUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  const getRes = await fetch(getUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!getRes.ok) {
    const text = await getRes.text().catch(() => "");
    throw new Error(`Calendar get failed (${getRes.status}): ${text || "no body"}`);
  }
  const ev = (await getRes.json()) as { attendees?: { email: string; displayName?: string }[] };
  const existing = ev.attendees ?? [];
  const already = existing.some(
    (a) => (a.email ?? "").toLowerCase() === input.newAttendee.email.toLowerCase(),
  );
  const next = already
    ? existing
    : [...existing, { email: input.newAttendee.email, displayName: input.newAttendee.displayName }];

  const patchUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  patchUrl.searchParams.set("sendUpdates", "all");
  const patchRes = await fetch(patchUrl.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      attendees: next,
    }),
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
  const getRes = await fetch(getUrl.toString(), {
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
  const patchRes = await fetch(patchUrl.toString(), {
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
  sendUpdates?: boolean;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar delete failed (${res.status}): ${text || "no body"}`);
  }
}
