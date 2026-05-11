"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  sendInterviewInvite,
  type SendInvitePartyResult,
} from "@/app/candidates/[id]/interview-actions";
import { updateEventAsInvite } from "@/lib/google-calendar";

// Dashboard "edit & resend invite" popup actions. Two responsibilities:
// 1. Hydrate the popup with whatever the calendar already shows for each
//    party (subject, description, attendees) so the recruiter is editing
//    the live invite, not a stale local copy.
// 2. Apply the edit. If the per-party event already exists, PATCH it
//    (Google emails attendees the updated invite). If it doesn't, fall
//    through to sendInterviewInvite which creates the event from scratch.

type Party = "client" | "candidate";

export type InviteParty = {
  party: Party;
  // Whether the per-party Google Calendar event already exists. Drives
  // the popup CTA copy ("Resend" vs "Send first invite").
  hasEvent: boolean;
  // Pre-fill values. Sourced from the live calendar event when one
  // exists; otherwise from the interview row + candidate row. The user
  // can edit any of these before sending.
  to: string;
  subject: string;
  body: string;
};

export type ClientContactSuggestion = {
  id: string;
  name: string;
  email: string;
  title: string | null;
};

export type InterviewInviteState =
  | {
      ok: true;
      value: {
        interviewId: string;
        candidateName: string;
        scheduledAt: string;
        durationMin: number;
        clientName: string;
        clientContacts: ClientContactSuggestion[];
        client: InviteParty;
        candidate: InviteParty;
      };
    }
  | { ok: false; error: string };

async function requireUser() {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true, email: true, name: true },
  });
  return u;
}

async function getFreshAccessToken(userId: string): Promise<string | null> {
  const acct = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
  if (!acct?.refresh_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (acct.access_token && acct.expires_at && acct.expires_at - now > 60) {
    return acct.access_token;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
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
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: { access_token: json.access_token, expires_at: expiresAt },
  });
  return json.access_token;
}

type CalendarEventSnapshot = {
  summary: string;
  description: string;
  attendees: { email: string; displayName?: string }[];
};

async function fetchEvent(userId: string, eventId: string): Promise<CalendarEventSnapshot | null> {
  const token = await getFreshAccessToken(userId);
  if (!token) return null;
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    summary?: string;
    description?: string;
    attendees?: { email: string; displayName?: string }[];
  };
  return {
    summary: json.summary ?? "",
    description: json.description ?? "",
    attendees: json.attendees ?? [],
  };
}

function defaultSubject(party: Party, candidateName: string, jobTitle: string, clientName: string): string {
  const prefix = party === "client" ? "Interview" : `Interview with ${clientName || "the team"}`;
  const tail = party === "client"
    ? `${candidateName || "candidate"} — ${jobTitle || "role"}`
    : `${jobTitle || "role"}`;
  return `${prefix}: ${tail}`;
}

function defaultBody(
  party: Party,
  candidateName: string,
  jobTitle: string,
  clientName: string,
): string {
  if (party === "client") {
    return [
      `Confirming the interview with ${candidateName || "the candidate"} for the ${jobTitle || "role"} role.`,
      "",
      "Reply to this invite if anything needs to change.",
    ].join("\n");
  }
  return [
    `You are confirmed for the ${jobTitle || "role"} interview${clientName ? ` with ${clientName}` : ""}.`,
    "",
    "Calendar invite + meeting details below. Good luck!",
  ].join("\n");
}

export async function getInterviewInviteState(interviewId: string): Promise<InterviewInviteState> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();

  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, organizationId: org.id },
    select: {
      id: true,
      candidateRfId: true,
      candidateId: true,
      jobId: true,
      jobRfId: true,
      clientId: true,
      scheduledAt: true,
      durationMin: true,
      googleEventIdClient: true,
      googleEventIdCandidate: true,
    },
  });
  if (!interview) return { ok: false, error: "Interview not found." };

  // Candidate identity. Ace-native rows carry candidateId (cuid); RF rows
  // carry candidateRfId. We need email + display name either way for the
  // candidate-side pre-fill.
  let candidateFirstName = "";
  let candidateLastName = "";
  let candidateEmail = "";
  if (interview.candidateId) {
    const c = await prisma.candidate.findUnique({
      where: { id: interview.candidateId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (c) {
      candidateFirstName = c.firstName ?? "";
      candidateLastName = c.lastName ?? "";
      candidateEmail = c.email ?? "";
    }
  }
  // RF-imported candidates land in the same Candidate table with rfId set
  // (Phase 0+ migration). Look them up the same way; Candidate.raw still
  // carries the original RF payload as fallback if structured cols are
  // empty.
  if (!candidateEmail && interview.candidateRfId != null) {
    const c = await prisma.candidate.findFirst({
      where: { rfId: interview.candidateRfId, organizationId: org.id },
      select: { firstName: true, lastName: true, email: true, raw: true },
    });
    if (c) {
      candidateFirstName = c.firstName ?? candidateFirstName;
      candidateLastName = c.lastName ?? candidateLastName;
      candidateEmail = c.email ?? candidateEmail;
      if (!candidateEmail && c.raw && typeof c.raw === "object") {
        const r = c.raw as Record<string, unknown>;
        if (typeof r.email === "string") candidateEmail = r.email;
      }
    }
  }
  const candidateName = [candidateFirstName, candidateLastName].filter(Boolean).join(" ") || "(candidate)";

  // Job + client display strings for default subject/body. Best-effort —
  // missing values fall through as empty strings and the defaults still
  // make sense.
  let jobTitle = "";
  let clientName = "";
  if (interview.jobId) {
    const j = await prisma.job.findUnique({
      where: { id: interview.jobId },
      select: { title: true, client: { select: { name: true } } },
    });
    if (j) {
      jobTitle = j.title ?? "";
      clientName = j.client?.name ?? "";
    }
  }
  if (!jobTitle && interview.jobRfId != null) {
    const j = await prisma.job.findFirst({
      where: { legacyRfId: interview.jobRfId, organizationId: org.id },
      select: { title: true, raw: true, client: { select: { name: true } } },
    });
    if (j) {
      jobTitle = j.title ?? jobTitle;
      if (!clientName) clientName = j.client?.name ?? clientName;
      if (!jobTitle && j.raw && typeof j.raw === "object") {
        const r = j.raw as Record<string, unknown>;
        if (typeof r.title === "string") jobTitle = r.title;
      }
    }
  }
  if (!clientName && interview.clientId) {
    const cl = await prisma.client.findUnique({
      where: { id: interview.clientId },
      select: { name: true },
    });
    if (cl) clientName = cl.name ?? "";
  }

  const clientEvent = interview.googleEventIdClient
    ? await fetchEvent(user.id, interview.googleEventIdClient).catch(() => null)
    : null;
  const candidateEvent = interview.googleEventIdCandidate
    ? await fetchEvent(user.id, interview.googleEventIdCandidate).catch(() => null)
    : null;

  // Pull every Contact at this client so the To: field on the Client
  // Invite can autocomplete to real names instead of forcing the
  // recruiter to remember + retype each address. Only contacts that
  // have at least one email are useful as suggestions.
  const clientContacts: ClientContactSuggestion[] = [];
  if (interview.clientId) {
    const rows = await prisma.contact.findMany({
      where: { clientId: interview.clientId, organizationId: org.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        name: true,
        emails: true,
        currentDesignation: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    for (const r of rows) {
      const display =
        [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || r.name?.trim() || "";
      for (const email of r.emails ?? []) {
        if (!email) continue;
        clientContacts.push({
          id: `${r.id}:${email}`,
          name: display || email,
          email,
          title: r.currentDesignation ?? null,
        });
      }
    }
  }

  return {
    ok: true,
    value: {
      interviewId: interview.id,
      candidateName,
      scheduledAt: interview.scheduledAt.toISOString(),
      durationMin: interview.durationMin,
      clientName,
      clientContacts,
      client: {
        party: "client",
        hasEvent: Boolean(clientEvent),
        to: clientEvent?.attendees[0]?.email ?? "",
        subject: clientEvent?.summary || defaultSubject("client", candidateName, jobTitle, clientName),
        body: clientEvent?.description || defaultBody("client", candidateName, jobTitle, clientName),
      },
      candidate: {
        party: "candidate",
        hasEvent: Boolean(candidateEvent),
        to: candidateEvent?.attendees[0]?.email ?? candidateEmail,
        subject: candidateEvent?.summary || defaultSubject("candidate", candidateName, jobTitle, clientName),
        body: candidateEvent?.description || defaultBody("candidate", candidateName, jobTitle, clientName),
      },
    },
  };
}

export type UpdateInterviewInviteInput = {
  interviewId: string;
  party: Party;
  attendeeEmail: string;
  attendeeName?: string;
  subject: string;
  body: string;
};

export async function updateInterviewInvite(
  input: UpdateInterviewInviteInput,
): Promise<SendInvitePartyResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  if (!input.attendeeEmail.trim()) return { ok: false, error: "Attendee email required." };
  if (!input.subject.trim()) return { ok: false, error: "Event title required." };
  if (!input.body.trim()) return { ok: false, error: "Event description required." };

  const interview = await prisma.interview.findFirst({
    where: { id: input.interviewId, organizationId: org.id },
    select: { id: true, googleEventIdClient: true, googleEventIdCandidate: true },
  });
  if (!interview) return { ok: false, error: "Interview not found." };

  const existingEventId =
    input.party === "client" ? interview.googleEventIdClient : interview.googleEventIdCandidate;

  // No event yet for this party — fall through to the canonical create
  // path so we get the same Meet attach + per-party event id persistence
  // the candidate-page flow uses.
  if (!existingEventId) {
    return sendInterviewInvite({
      interviewId: input.interviewId,
      party: input.party,
      attendeeEmail: input.attendeeEmail.trim(),
      attendeeName: input.attendeeName,
      subject: input.subject,
      bodyText: input.body,
    });
  }

  // Event exists — PATCH it. updateEventAsInvite sets sendUpdates=all so
  // Google re-emails the invite to attendees with the new content. If the
  // recruiter changed the To: address, the new email gets added; the old
  // attendee stays on the event (Google's PATCH semantics — we'd have to
  // explicitly remove them, which is its own action).
  try {
    await updateEventAsInvite({
      userId: user.id,
      eventId: existingEventId,
      summary: input.subject,
      description: input.body,
      newAttendees: [{ email: input.attendeeEmail.trim(), displayName: input.attendeeName }],
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Calendar update failed: ${e.message}` : "Calendar update failed.",
    };
  }

  revalidatePath("/dashboard");

  return {
    ok: true,
    value: {
      googleEventId: existingEventId,
      meetLink: null,
    },
  };
}
