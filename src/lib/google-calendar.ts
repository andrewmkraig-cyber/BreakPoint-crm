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

export const MEET_SPACE_SETTINGS_SCOPE = "https://www.googleapis.com/auth/meetings.space.settings";

// Pings Google's tokeninfo endpoint to list the scopes associated with the
// user's current access token. Used as a preflight check before calling the
// Meet API — if the scope isn't there, the Meet call will 401/403 silently
// and the UI will never know why. Cheaper to ask tokeninfo first.
export async function getGrantedScopes(userId: string): Promise<string[]> {
  const token = await getFreshAccessToken(userId);
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { scope?: string };
  return (data.scope ?? "").split(/\s+/).filter(Boolean);
}

export type SetMeetOpenResult =
  | { ok: true; status: number }
  | {
      ok: false;
      reason: "scope_missing" | "http" | "unknown";
      error: string;
      status?: number;
      responseBody?: string;
    };

// Sets the Meet space's access type to OPEN so anyone with the link can
// join without a host letting them in. Needs the
// `https://www.googleapis.com/auth/meetings.space.settings` OAuth scope.
//
// Two-step approach for robustness:
//   1. tokeninfo preflight — if the scope isn't on the token, return a
//      structured `scope_missing` error with reauth instructions instead of
//      making a doomed API call.
//   2. Meet API v2 spaces.patch — logs the full response (status + body)
//      and returns structured results the caller can surface in the UI.
export async function setMeetOpenAccess(params: {
  userId: string;
  meetingCode: string;
}): Promise<SetMeetOpenResult> {
  try {
    const scopes = await getGrantedScopes(params.userId);
    if (!scopes.includes(MEET_SPACE_SETTINGS_SCOPE)) {
      const msg = `Meet scope "${MEET_SPACE_SETTINGS_SCOPE}" not granted on your Google token. Revoke Ace at https://myaccount.google.com/permissions, then sign in again.`;
      console.warn(`[setMeetOpenAccess] scope_missing: granted=[${scopes.join(", ")}]`);
      return { ok: false, reason: "scope_missing", error: msg };
    }

    const accessToken = await getFreshAccessToken(params.userId);
    const url = new URL(
      `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(params.meetingCode)}`,
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
    const bodyText = await res.text().catch(() => "");
    console.log(
      `[setMeetOpenAccess] PATCH ${url.toString()} -> ${res.status} ${res.statusText} | body=${bodyText.slice(0, 1000)}`,
    );
    if (!res.ok) {
      return {
        ok: false,
        reason: "http",
        status: res.status,
        responseBody: bodyText,
        error: `Meet spaces.patch ${res.status}: ${bodyText.slice(0, 400) || "no body"}`,
      };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[setMeetOpenAccess] unexpected: ${msg}`);
    return { ok: false, reason: "unknown", error: msg };
  }
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
  const res = await fetch(url.toString(), {
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
  const res = await fetch(url.toString(), {
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
