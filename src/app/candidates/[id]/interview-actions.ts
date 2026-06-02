"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { logActivity } from "@/lib/activity";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEventAttendees,
  getEventConferenceData,
  patchCalendarEventDetails,
  updateCalendarEvent,
  updateEventAsInvite,
} from "@/lib/google-calendar";
import { sendGmail } from "@/lib/gmail";
import {
  formatInterviewDate,
  formatInterviewTime,
  formatInterviewWhen,
} from "@/lib/interview-format";
import { createTeamsMeeting, getMicrosoftToken, TEAMS_TOKEN_EXPIRED_MESSAGE } from "@/lib/microsoft-graph";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_INTERVIEW_PREP_TRIGGER,
  CLIENT_INTERVIEW_SCHEDULED_TRIGGER,
} from "@/app/settings/template-constants";

// Unified interview actions for both RF-backed candidates (candidateRfId) and
// Ace-local candidates (candidateId cuid). The Interview model is polymorphic
// on candidate; every action carries exactly one of the two.
//
// Scheduling an interview auto-upgrades Placement.stage to "interviewing" if
// (and only if) the current stage is earlier than "interviewing". We never
// downgrade from offer/pending_start/hired, and we never change cancelled or
// rejected rows.

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

type SessionUser = { id: string; email: string; name: string | null };

async function requireUser(): Promise<SessionUser | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!u || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name };
}

export type InterviewType = "phone_screen" | "video" | "in_person";
export type InterviewSource = "ace_scheduled" | "client_scheduled";
// Which provider mints the video meeting link for a video interview.
// Defaults to "google" everywhere it's omitted so existing callers
// keep their current Google Meet behavior. "teams" routes through
// Microsoft Graph /me/onlineMeetings on the org's connected
// Microsoft account.
export type MeetingProvider = "google" | "teams";

export type InterviewAttendee = { id?: number; name: string; email: string };

export type ScheduleInterviewInput = {
  // Exactly one of the two identifiers is set.
  candidateRfId?: number | null;
  candidateId?: string | null;
  // The exact Placement row the pill is rendering, when known. Passing it
  // lets scheduling UPDATE that row's stage in place instead of re-deriving
  // the placement from (candidateId, jobRfId) — which misses for Ace-native
  // rows whose stored jobRfId is null/synthetic and mints a duplicate pill.
  placementId?: string | null;
  jobRfId: number;
  clientRfId: number;
  scheduledAt: string; // ISO datetime
  durationMin: number;
  type: InterviewType;
  attendees?: InterviewAttendee[];
  candidatePhone?: string;
  notes?: string;
  source: InterviewSource;
  // Street address for in_person interviews. Stored on the Interview row
  // and passed to Google Calendar event.location on the per-party invites.
  location?: string;
  // Summary/description for the calendar event and candidate-facing activity log.
  jobTitle?: string;
  clientName?: string;
  candidateName?: string;
  // IANA timezone the recruiter picked for this interview. Threaded into
  // the tracking event (client_scheduled) and forwarded back to the
  // invite flow so the per-party events use the same zone.
  timeZone?: string;
  // Provider used to mint the join link for video interviews. Defaults
  // to "google". Only consulted when type === "video" AND source ===
  // "ace_scheduled"; the client-scheduled path never mints a link
  // either way.
  meetingType?: MeetingProvider;
};

export type ScheduleInterviewResult =
  | {
      ok: true;
      value: {
        interviewId: string;
        meetLink: string | null;
        googleEventIdMine: string | null;
      };
    }
  | { ok: false; error: string };

const EARLIER_STAGES = new Set(["sourced", "applied", "submitted"]);

function normalizeRefs(input: { candidateRfId?: number | null; candidateId?: string | null }): {
  candidateRfId: number | null;
  candidateId: string | null;
  error?: string;
} {
  const rfId = typeof input.candidateRfId === "number" && Number.isFinite(input.candidateRfId) ? input.candidateRfId : null;
  const localId = typeof input.candidateId === "string" && input.candidateId.trim().length > 0 ? input.candidateId : null;
  if (rfId == null && localId == null) {
    return { candidateRfId: null, candidateId: null, error: "Candidate reference is required." };
  }
  if (rfId != null && localId != null) {
    return { candidateRfId: null, candidateId: null, error: "Cannot pass both candidateRfId and candidateId." };
  }
  return { candidateRfId: rfId, candidateId: localId };
}

async function upsertInterviewingStage(args: {
  candidateRfId: number | null;
  candidateId: string | null;
  placementId?: string | null;
  jobRfId: number;
  clientRfId: number;
  userId: string;
  organizationId: string;
}) {
  // Fast path: the caller handed us the exact Placement row the pill is
  // rendering. Update it in place (bump to interviewing only if it's still
  // an earlier stage) and stop — this is the canonical anti-duplicate path
  // for Ace-native rows, where the (candidateId, jobRfId) lookup below
  // would miss (stored jobRfId is null/synthetic) and mint a second pill.
  // Skip synthetic optimistic ids that aren't real Placement rows yet.
  if (args.placementId && !args.placementId.startsWith("local-applied-")) {
    const row = await prisma.placement.findFirst({
      where: { id: args.placementId, organizationId: args.organizationId },
      select: { id: true, stage: true },
    });
    if (row) {
      if (EARLIER_STAGES.has(row.stage)) {
        await prisma.placement.update({
          where: { id: row.id },
          data: { stage: "interviewing", syncedToRf: false },
        });
      }
      return;
    }
    // No row for that id (stale optimistic pill / cross-tenant id) — fall
    // through to the identity-based upsert below.
  }

  const whereUnique = args.candidateRfId != null
    ? { candidateRfId_jobRfId: { candidateRfId: args.candidateRfId, jobRfId: args.jobRfId } }
    : { candidateId_jobRfId: { candidateId: args.candidateId!, jobRfId: args.jobRfId } };
  const existing = await prisma.placement.findUnique({ where: whereUnique, select: { id: true, stage: true } });
  if (!existing) {
    // Phase 4b: resolve cuid FKs for the new Placement row so the
    // (jobId, clientId) cuid pointers get stamped on create. Look up
    // only for positive legacyRfIds — synthetic negatives never match.
    const [jobRow, clientRow] = await Promise.all([
      args.jobRfId > 0
        ? prisma.job.findFirst({
            where: { legacyRfId: args.jobRfId, organizationId: args.organizationId },
            select: { id: true },
          })
        : Promise.resolve(null),
      args.clientRfId > 0
        ? prisma.client.findFirst({
            where: { legacyRfId: args.clientRfId, organizationId: args.organizationId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    // Placement has three @@unique tuples: (candidateRfId,jobRfId),
    // (candidateId,jobRfId), and (candidateId,jobId). The findUnique above
    // probes the first two, but an existing row keyed on (candidateId,
    // jobId) can still collide here — e.g. when a recruiter rescheduled
    // off an Ace-native Job whose jobRfId was synthetic-negative on the
    // earlier row and zero/different on this one. Catch P2002 and treat
    // it as "placement already exists, just bump the stage if it's
    // earlier" so a new interview still saves instead of bubbling a hard
    // Prisma error to the recruiter.
    try {
      await prisma.placement.create({
        data: {
          candidateRfId: args.candidateRfId,
          candidateId: args.candidateId,
          jobRfId: args.jobRfId,
          jobId: jobRow?.id ?? null,
          clientRfId: args.clientRfId,
          clientId: clientRow?.id ?? null,
          stage: "interviewing",
          createdById: args.userId,
          organizationId: args.organizationId,
          syncedToRf: false,
        },
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "P2002") throw e;
      if (args.candidateId && jobRow?.id) {
        const conflict = await prisma.placement.findUnique({
          where: { candidateId_jobId: { candidateId: args.candidateId, jobId: jobRow.id } },
          select: { id: true, stage: true },
        });
        if (conflict && EARLIER_STAGES.has(conflict.stage)) {
          await prisma.placement.update({
            where: { id: conflict.id },
            data: { stage: "interviewing", syncedToRf: false },
          });
        }
      }
    }
    return;
  }
  if (EARLIER_STAGES.has(existing.stage)) {
    await prisma.placement.update({
      where: { id: existing.id },
      data: { stage: "interviewing", syncedToRf: false },
    });
  }
}

function revalidateForCandidate(ref: { candidateRfId: number | null; candidateId: string | null }) {
  if (ref.candidateRfId != null) revalidatePath(`/candidates/${ref.candidateRfId}`);
  if (ref.candidateId != null) revalidatePath(`/candidates/${ref.candidateId}`);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

// CalendarEvent (the local Google-mirror used by /calendar + the
// Clubhouse "This Week" widget) is normally rebuilt by the on-demand
// sync route. That sync only runs when the page loads, so cancel /
// reschedule / update need to keep the mirror in step with the live
// Google PATCH/DELETE we just made — otherwise stale CONFIRMED rows
// keep showing up alongside the new event (the Jennifer Cole bug).
//
// Scope by organizationId so a stray same-id event on another tenant
// can't get clobbered. Returns silently if no mirror rows exist (the
// event was created off-cycle and a sync hasn't pulled it in yet);
// the next sync pass will pick up the cancellation.
async function markLocalCalendarEventsCancelled(args: {
  organizationId: string;
  googleEventIds: string[];
}): Promise<void> {
  const ids = Array.from(new Set(args.googleEventIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return;
  try {
    await prisma.calendarEvent.updateMany({
      where: { organizationId: args.organizationId, googleEventId: { in: ids } },
      data: { status: "CANCELLED", syncedAt: new Date() },
    });
  } catch {
    // best-effort — the next /api/calendar/sync run will reconcile.
  }
}

async function updateLocalCalendarEventsTime(args: {
  organizationId: string;
  googleEventIds: string[];
  startTime: Date;
  endTime: Date;
  location?: string | null;
}): Promise<void> {
  const ids = Array.from(new Set(args.googleEventIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return;
  try {
    await prisma.calendarEvent.updateMany({
      where: { organizationId: args.organizationId, googleEventId: { in: ids } },
      data: {
        startTime: args.startTime,
        endTime: args.endTime,
        ...(args.location !== undefined ? { location: args.location ?? null } : {}),
        // A rescheduled event is canonically scheduled again — flip
        // any prior CANCELLED row back to CONFIRMED.
        status: "CONFIRMED",
        syncedAt: new Date(),
      },
    });
  } catch {
    // best-effort
  }
}

async function updateLocalCalendarEventDetails(args: {
  organizationId: string;
  googleEventId: string | null;
  title: string;
  description: string;
}): Promise<void> {
  if (!args.googleEventId) return;
  try {
    await prisma.calendarEvent.updateMany({
      where: { organizationId: args.organizationId, googleEventId: args.googleEventId },
      data: {
        title: args.title,
        description: args.description,
        status: "CONFIRMED",
        syncedAt: new Date(),
      },
    });
  } catch {
    // best-effort; Google remains the source of truth.
  }
}

function calendarSummary(input: ScheduleInterviewInput): string {
  const who = input.candidateName || "Candidate";
  const job = input.jobTitle || "role";
  const client = input.clientName ? ` (${input.clientName})` : "";
  const kind =
    input.type === "phone_screen" ? "Phone Screen" : input.type === "video" ? "Interview" : "Onsite";
  return `${kind}: ${who} - ${job}${client}`;
}

function calendarDescription(input: ScheduleInterviewInput): string {
  const lines: string[] = [];
  if (input.candidateName) lines.push(`Candidate: ${input.candidateName}`);
  if (input.jobTitle) lines.push(`Role: ${input.jobTitle}`);
  if (input.clientName) lines.push(`Client: ${input.clientName}`);
  if (input.candidatePhone) lines.push(`Candidate phone: ${input.candidatePhone}`);
  if (input.location) lines.push(`Location: ${input.location}`);
  // Interviewers live in Interview.clientAttendees and are added only to
  // the client-facing invite. Don't echo them into the description; the
  // edit drawer hydrates the Guests field from that local JSON.
  if (input.notes) lines.push("", input.notes);
  lines.push("", "Logged from Ace (BreakPoint Talent CRM).");
  return lines.join("\n");
}

function isGoogleMeetLink(link: string | null | undefined): boolean {
  return Boolean(link && /meet\.google\.com\//i.test(link));
}

export async function scheduleInterview(input: ScheduleInterviewInput): Promise<ScheduleInterviewResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const ref = normalizeRefs(input);
  if (ref.error) return { ok: false, error: ref.error };

  if (!input.scheduledAt) return { ok: false, error: "Date/time is required." };
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date/time." };
  if (!input.type) return { ok: false, error: "Interview type is required." };
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return { ok: false, error: "Duration must be positive." };
  }

  // Calendar behavior:
  // - ace_scheduled: create one organizer-only tracking event on the
  //   creator's primary calendar. The first Send Invite reuses that event
  //   for that party; the second Send Invite creates a separate event with
  //   the same Meet link, so client and candidate keep unique invite bodies.
  //   The tracking event must stay attendee-free: if we seed the client
  //   interviewer as a silent guest, Google's later invite PATCH mails them
  //   an "updated invitation" when the candidate copy is sent.
  // - client_scheduled: the client is sending their own invite. We put a
  //   tracking event on the creator's calendar (no attendees, no Meet),
  //   and no emails go out.
  let googleEventIdMine: string | null = null;
  let meetLink: string | null = null;
  let meetConferenceId: string | null = null;
  const meetingProvider: MeetingProvider = input.meetingType ?? "google";
  const wantsVideoLink = input.source === "ace_scheduled" && input.type === "video";
  try {
    const ev = await createCalendarEvent({
      userId: user.id,
      summary: calendarSummary(input),
      description: calendarDescription(input),
      startISO: when.toISOString(),
      durationMin: input.durationMin,
      attendees: [],
      // Mint a Google Meet only when the video interview is staying on
      // Google. For Teams we still create the organizer-only tracking
      // calendar event but skip conferenceData entirely and overwrite
      // meetLink below with the Teams joinWebUrl.
      createMeet: wantsVideoLink && meetingProvider === "google",
      sendUpdates: false,
      location: input.location || undefined,
      timeZone: input.timeZone,
    });
    googleEventIdMine = ev.eventId;
    meetLink = ev.meetLink;
    meetConferenceId = ev.meetingCode;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Calendar create failed: ${e.message}` : "Calendar create failed.",
    };
  }

  if (wantsVideoLink && meetingProvider === "teams") {
    const org = await getCurrentOrg();
    // Guard before minting the Teams link: getMicrosoftToken refreshes
    // when it can and flips the org's token row to "expired" (returning
    // null) when the refresh grant is dead. A null here means the
    // recruiter must reconnect: bail with an actionable message rather
    // than leaving the Google tracking event behind as a broken stub.
    const teamsToken = await getMicrosoftToken(org.id);
    if (!teamsToken) {
      if (googleEventIdMine) {
        try {
          await deleteCalendarEvent({ userId: user.id, eventId: googleEventIdMine, sendUpdates: false });
        } catch {
          // best-effort
        }
      }
      return { ok: false, error: TEAMS_TOKEN_EXPIRED_MESSAGE };
    }
    try {
      const endISO = new Date(when.getTime() + input.durationMin * 60 * 1000).toISOString();
      const meeting = await createTeamsMeeting({
        organizationId: org.id,
        startISO: when.toISOString(),
        endISO,
        subject: calendarSummary(input),
      });
      meetLink = meeting.joinWebUrl;
      meetConferenceId = meeting.meetingId;
    } catch (e) {
      // Roll back the Google tracking event we just created so we
      // don't leave an orphan with no working join link.
      if (googleEventIdMine) {
        try {
          await deleteCalendarEvent({ userId: user.id, eventId: googleEventIdMine, sendUpdates: false });
        } catch {
          // best-effort
        }
      }
      // createTeamsMeeting only ever throws clean, user-safe messages
      // (the expired-token copy or a generic retry line) and logs the raw
      // Graph body server-side, so surface the message as-is. No prefix,
      // no raw JSON.
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Couldn't create the Teams meeting.",
      };
    }
  }

  try {
    const org = await getCurrentOrg();
    const interview = await prisma.interview.create({
      data: {
        candidateRfId: ref.candidateRfId,
        candidateId: ref.candidateId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        scheduledAt: when,
        durationMin: input.durationMin,
        type: input.type,
        meetLink,
        meetConferenceId,
        clientAttendees: input.attendees && input.attendees.length > 0 ? (input.attendees as object) : undefined,
        candidatePhone: input.candidatePhone || null,
        location: input.location || null,
        notes: input.notes || null,
        status: "scheduled",
        source: input.source,
        googleEventIdMine,
        createdById: user.id,
        organizationId: org.id,
      },
      select: { id: true },
    });

    await upsertInterviewingStage({
      candidateRfId: ref.candidateRfId,
      candidateId: ref.candidateId,
      placementId: input.placementId ?? null,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      userId: user.id,
      organizationId: org.id,
    });

    const subjectId = ref.candidateRfId != null ? String(ref.candidateRfId) : ref.candidateId!;
    await createActionLog({
      userId: user.id,
      actionType: "schedule_interview",
      subjectType: "candidate",
      subjectId,
      metadata: {
        interviewId: interview.id,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        scheduledAt: when.toISOString(),
        durationMin: input.durationMin,
        type: input.type,
        source: input.source,
        meetLink,
        googleEventIdMine,
        local: ref.candidateId != null,
      },
    });

    // Phase 4d: ActivityLog audit-feed entry.
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "interview_scheduled",
      targetType: "interview",
      targetId: interview.id,
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        candidateRfId: ref.candidateRfId,
        candidateId: ref.candidateId,
        scheduledAt: when.toISOString(),
        durationMin: input.durationMin,
        type: input.type,
        source: input.source,
      },
    });

    revalidateForCandidate(ref);

    // No separate confirmation email — the native Google Calendar invite
    // is the only communication. The composer body the recruiter types
    // becomes the event description, so the invite + custom prep tips
    // land as a single message in the attendee's inbox.

    return { ok: true, value: { interviewId: interview.id, meetLink, googleEventIdMine } };
  } catch (e) {
    if (googleEventIdMine) {
      try {
        await deleteCalendarEvent({ userId: user.id, eventId: googleEventIdMine, sendUpdates: false });
      } catch {
        // best-effort; ignore cleanup failure
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save interview." };
  }
}

// ---- Cancel ----

// D2: cancel cancels the WHOLE interview (every Google event tied to it).
// `notifyGuests` drives the two-way Cancel choice:
//   - true  → Google sends the cancellation notice on every event.
//   - false → events are deleted silently, no email.
//   - undefined (legacy callers, e.g. the in-flight schedule abort) keeps
//     the prior behavior: notify only when a party invite actually went out.
export async function cancelInterview(
  interviewId: string,
  opts?: { notifyGuests?: boolean },
): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  try {
    const existing = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true,
        status: true,
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
        candidateRfId: true,
        candidateId: true,
      },
    });
    if (!existing) return { ok: false, error: "Interview not found." };
    if (existing.status === "cancelled") return { ok: true };

    // Delete every Google event tied to this interview. Ace-scheduled
    // interviews can have an organizer tracking event plus one event per
    // party; dedupe so reusing the tracking event for the first party does
    // not double-delete. Notify when any party invite went out.
    const allEventIds = [
      existing.googleEventIdMine,
      existing.googleEventIdClient,
      existing.googleEventIdCandidate,
    ].filter((id): id is string => Boolean(id));
    const uniqueEventIds = Array.from(new Set(allEventIds));
    const anyInviteSent = Boolean(
      existing.googleEventIdClient || existing.googleEventIdCandidate,
    );
    // Explicit choice wins; legacy callers fall back to "notify iff an
    // invite was actually sent".
    const notifyGuests = opts?.notifyGuests ?? anyInviteSent;
    for (const id of uniqueEventIds) {
      try {
        await deleteCalendarEvent({ userId: user.id, eventId: id, sendUpdates: notifyGuests });
      } catch {
        // best-effort
      }
    }

    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "cancelled" },
    });

    const org = await getCurrentOrg();
    // Keep the /calendar + dashboard CalendarEvent mirror in step with
    // the live Google delete — without this the row stays CONFIRMED
    // until the next on-demand sync, and the widget renders it next
    // to any replacement interview as a "second" event.
    await markLocalCalendarEventsCancelled({
      organizationId: org.id,
      googleEventIds: uniqueEventIds,
    });

    const subjectId = existing.candidateRfId != null ? String(existing.candidateRfId) : existing.candidateId!;
    await createActionLog({
      userId: user.id,
      actionType: "cancel_interview",
      subjectType: "candidate",
      subjectId,
      metadata: { interviewId },
    });

    // Phase 4d: ActivityLog audit-feed entry. cancelInterview has no
    // reason field today (single-click cancel from the activity panel);
    // metadata carries the calendar-event delete tally + source so the
    // activity feed can render "cancelled by {user}" without a join.
    const eventDeletions = uniqueEventIds.length;
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "interview_cancelled",
      targetType: "interview",
      targetId: interviewId,
      metadata: {
        candidateRfId: existing.candidateRfId,
        candidateId: existing.candidateId,
        priorStatus: existing.status,
        calendarEventsDeleted: eventDeletions,
      },
    });

    revalidateForCandidate({ candidateRfId: existing.candidateRfId, candidateId: existing.candidateId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancel failed." };
  }
}

// ---- Reschedule ----

export type RescheduleInterviewInput = {
  interviewId: string;
  scheduledAt: string;
  durationMin?: number;
  timeZone?: string;
};

export async function rescheduleInterview(input: RescheduleInterviewInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.scheduledAt) return { ok: false, error: "Date/time is required." };
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date/time." };

  try {
    const existing = await prisma.interview.findUnique({
      where: { id: input.interviewId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        durationMin: true,
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
        candidateRfId: true,
        candidateId: true,
      },
    });
    if (!existing) return { ok: false, error: "Interview not found." };
    if (existing.status === "cancelled") return { ok: false, error: "Can't reschedule a cancelled interview." };

    const durationMin = input.durationMin && input.durationMin > 0 ? input.durationMin : existing.durationMin;

    // Push the new time to every related Google event. The first party can
    // reuse googleEventIdMine, so dedupe before PATCHing to avoid duplicate
    // attendee notifications.
    const allEventIds = [
      existing.googleEventIdMine,
      existing.googleEventIdClient,
      existing.googleEventIdCandidate,
    ].filter((id): id is string => Boolean(id));
    const uniqueEventIds = Array.from(new Set(allEventIds));
    const anyInviteSent = Boolean(
      existing.googleEventIdClient || existing.googleEventIdCandidate,
    );
    for (const id of uniqueEventIds) {
      try {
        await updateCalendarEvent({
          userId: user.id,
          eventId: id,
          startISO: when.toISOString(),
          durationMin,
          sendUpdates: anyInviteSent,
          timeZone: input.timeZone,
        });
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? `Calendar update failed: ${e.message}` : "Calendar update failed.",
        };
      }
    }

    await prisma.interview.update({
      where: { id: input.interviewId },
      data: { scheduledAt: when, durationMin, status: "scheduled" },
    });

    // Push the new time onto the local CalendarEvent mirror so the
    // /calendar grid + Clubhouse widget show the rescheduled time
    // immediately, without waiting for the next on-demand Google sync.
    const orgForReschedule = await getCurrentOrg();
    const endTime = new Date(when.getTime() + durationMin * 60 * 1000);
    await updateLocalCalendarEventsTime({
      organizationId: orgForReschedule.id,
      googleEventIds: uniqueEventIds,
      startTime: when,
      endTime,
    });

    const subjectId = existing.candidateRfId != null ? String(existing.candidateRfId) : existing.candidateId!;
    await createActionLog({
      userId: user.id,
      actionType: "reschedule_interview",
      subjectType: "candidate",
      subjectId,
      metadata: {
        interviewId: input.interviewId,
        from: existing.scheduledAt.toISOString(),
        to: when.toISOString(),
        durationMin,
      },
    });

    revalidateForCandidate({ candidateRfId: existing.candidateRfId, candidateId: existing.candidateId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reschedule failed." };
  }
}

// D2: when an edit moves the interview time, the verbatim sent-copy stored
// in D1 (sentCandidateBody/sentClientBody + subjects) still shows the OLD
// date/time the recipient was originally emailed. The invite bodies bake the
// date/time in as literal formatted strings (the `[Interview Date Time]` /
// `[Interview Date]` / `[Interview Time]` / `[Interview Duration]` merge
// fields are resolved at send time), so we restamp by string-replacing the
// old formatted strings with the new ones using the SAME formatters that
// produced them. Best-effort: if the formatted string isn't found (e.g. the
// recruiter changed timezone too, or the body never referenced the time),
// the replace is a safe no-op and the stored copy is left untouched.
function restampSentCopyDateTime(
  stored: string | null | undefined,
  oldWhen: Date,
  newWhen: Date,
  oldDurationMin: number,
  newDurationMin: number,
  tz: string,
): string | null {
  if (!stored) return stored ?? null;
  let out = stored;
  // When (date + time, longest) first so its embedded time substring is
  // swapped as a unit before the standalone time pass runs.
  const pairs: Array<[string, string]> = [
    [formatInterviewWhen(oldWhen, tz), formatInterviewWhen(newWhen, tz)],
    [formatInterviewDate(oldWhen, tz), formatInterviewDate(newWhen, tz)],
    [formatInterviewTime(oldWhen, tz), formatInterviewTime(newWhen, tz)],
    [`${oldDurationMin} min`, `${newDurationMin} min`],
  ];
  for (const [from, to] of pairs) {
    if (from && to && from !== to) out = out.split(from).join(to);
  }
  return out;
}

// ---- Update interview (full edit) ----
//
// Used by the edit-interview modal which needs to mutate every field a
// recruiter can change (time, duration, type, location, interviewer, etc.)
// AND offer three notify modes — each driving the candidate event and the
// client event INDEPENDENTLY (they are separate Google events):
//
//   - notifyMode: "all"      — patches both events with sendUpdates "all",
//                              so Google emails every guest on BOTH events
//                              the update.
//   - notifyMode: "new_only" — patches both events silently (sendUpdates
//                              "none"), then adds only the newly-added
//                              attendees (which attach to the client event)
//                              with sendUpdates "all". Existing guests on
//                              either event are NOT re-notified; only the
//                              new attendee(s) get a fresh invitation email.
//   - notifyMode: "none"     — patches both events silently (sendUpdates
//                              "none"); no notification email goes out at
//                              all, including to any newly-added attendee.
//
// The calendar event time always moves on a date/time change regardless of
// the chosen mode; only WHO gets emailed varies. The "interviewer" field in
// the modal is the primary client attendee.

export type UpdateInterviewInput = {
  interviewId: string;
  scheduledAt: string;
  durationMin: number;
  type: InterviewType;
  timeZone: string;
  location?: string;
  attendees?: InterviewAttendee[];
  candidatePhone?: string;
  notes?: string;
  notifyMode: "all" | "new_only" | "none";
  jobTitle?: string;
  clientName?: string;
  candidateName?: string;
};

export async function updateInterview(input: UpdateInterviewInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.scheduledAt) return { ok: false, error: "Date/time is required." };
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date/time." };
  if (!input.type) return { ok: false, error: "Interview type is required." };
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return { ok: false, error: "Duration must be positive." };
  }

  const existing = await prisma.interview.findUnique({
    where: { id: input.interviewId },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      durationMin: true,
      type: true,
      location: true,
      candidatePhone: true,
      notes: true,
      clientAttendees: true,
      googleEventIdMine: true,
      googleEventIdClient: true,
      googleEventIdCandidate: true,
      candidateRfId: true,
      candidateId: true,
      sentCandidateSubject: true,
      sentCandidateBody: true,
      sentClientSubject: true,
      sentClientBody: true,
    },
  });
  if (!existing) return { ok: false, error: "Interview not found." };
  if (existing.status === "cancelled") {
    return { ok: false, error: "Can't edit a cancelled interview." };
  }

  // Per Ace 43: edits leave the Google event's body (description) and
  // title (summary) untouched. Only date/time/duration/location flow to
  // the calendar so the invite the recruiter wrote at send-time stays
  // canonical. Description tweaks happen via the dashboard's edit-and-
  // resend popup, which already round-trips through the live event.

  // De-dupe the per-party event-id columns: the first invite can reuse the
  // schedule-time tracking event, so PATCHing every column naively could
  // notify the same attendees more than once.
  const allEventIds = [
    existing.googleEventIdMine,
    existing.googleEventIdClient,
    existing.googleEventIdCandidate,
  ].filter((id): id is string => Boolean(id));
  const uniqueEventIds = Array.from(new Set(allEventIds));

  // The time/header field patch is sent to BOTH events independently.
  // "all" emails every guest on each event; "new_only" and "none" patch
  // silently. The time always moves regardless of mode — only WHO is
  // emailed differs. `input.location` is passed through verbatim: when it
  // is undefined the calendar location is left unchanged (a time-only edit
  // must not wipe an in-person address).
  const fieldPatchSendUpdates = input.notifyMode === "all" ? "all" : "none";
  // Newly-added attendees get an invite only in "all" / "new_only" mode;
  // "none" adds them silently with no notification email.
  const attendeeAddSendUpdates = input.notifyMode === "none" ? "none" : "all";
  try {
    for (const eventId of uniqueEventIds) {
      await patchCalendarEventDetails({
        userId: user.id,
        eventId,
        sendUpdates: fieldPatchSendUpdates,
        startISO: when.toISOString(),
        durationMin: input.durationMin,
        timeZone: input.timeZone,
        location: input.location,
      });

      // The edit modal's attendees are client-side interviewer contacts.
      // With separate client/candidate invite events, only the client event
      // should receive those attendees; the candidate event stays private.
      // "none" mode adds them silently; otherwise the new attendee(s) get a
      // fresh invitation while existing guests are never re-notified (the
      // field patch above already ran silently for new_only).
      const isClientInviteEvent = existing.googleEventIdClient
        ? eventId === existing.googleEventIdClient
        : eventId === existing.googleEventIdMine && !existing.googleEventIdCandidate;
      if (isClientInviteEvent && input.attendees && input.attendees.length > 0) {
        const currentAttendees = await getCalendarEventAttendees({
          userId: user.id,
          eventId,
        });
        const seen = new Set(currentAttendees.map((a) => a.email.toLowerCase()));
        const additions = input.attendees
          .map((a) => ({ email: a.email.trim(), displayName: a.name?.trim() || undefined }))
          .filter((a) => a.email.length > 0 && !seen.has(a.email.toLowerCase()));
        if (additions.length > 0) {
          const nextAttendees = [
            ...currentAttendees,
            ...additions,
          ];
          await patchCalendarEventDetails({
            userId: user.id,
            eventId,
            sendUpdates: attendeeAddSendUpdates,
            attendees: nextAttendees,
          });
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? `Calendar update failed: ${e.message}` : "Calendar update failed.",
    };
  }

  const clientAttendeesJson =
    input.attendees && input.attendees.length > 0
      ? (input.attendees as unknown as object)
      : (existing.clientAttendees as unknown as object | null) ?? undefined;

  // D2: restamp the stored sent-copy (what the recipient saw) when the time
  // moved, so the calendar's "what was emailed" detail no longer shows the
  // old date/time. Best-effort string replacement keyed to the same
  // formatters that produced the body — see restampSentCopyDateTime.
  const timeMoved =
    existing.scheduledAt.getTime() !== when.getTime() ||
    existing.durationMin !== input.durationMin;
  const sentCopyUpdate = timeMoved
    ? {
        sentCandidateSubject: restampSentCopyDateTime(
          existing.sentCandidateSubject, existing.scheduledAt, when,
          existing.durationMin, input.durationMin, input.timeZone,
        ),
        sentCandidateBody: restampSentCopyDateTime(
          existing.sentCandidateBody, existing.scheduledAt, when,
          existing.durationMin, input.durationMin, input.timeZone,
        ),
        sentClientSubject: restampSentCopyDateTime(
          existing.sentClientSubject, existing.scheduledAt, when,
          existing.durationMin, input.durationMin, input.timeZone,
        ),
        sentClientBody: restampSentCopyDateTime(
          existing.sentClientBody, existing.scheduledAt, when,
          existing.durationMin, input.durationMin, input.timeZone,
        ),
      }
    : {};

  await prisma.interview.update({
    where: { id: input.interviewId },
    data: {
      scheduledAt: when,
      durationMin: input.durationMin,
      type: input.type,
      // Pass-through: only overwrite the address when the caller actually
      // sent one. A time-only edit (undefined) leaves the stored address as-is.
      ...(input.location !== undefined ? { location: input.location || null } : {}),
      candidatePhone: input.candidatePhone ?? existing.candidatePhone,
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(clientAttendeesJson !== undefined ? { clientAttendees: clientAttendeesJson } : {}),
      ...sentCopyUpdate,
      status: "scheduled",
    },
  });

  // Mirror sync — same rationale as the reschedule path: the
  // /calendar grid + Clubhouse widget read CalendarEvent rows, not
  // Interview rows, so the post-edit time has to land there too.
  const orgForUpdate = await getCurrentOrg();
  const endTimeUpdate = new Date(when.getTime() + input.durationMin * 60 * 1000);
  await updateLocalCalendarEventsTime({
    organizationId: orgForUpdate.id,
    googleEventIds: uniqueEventIds,
    startTime: when,
    endTime: endTimeUpdate,
    location: input.location ?? null,
  });

  const subjectId =
    existing.candidateRfId != null ? String(existing.candidateRfId) : existing.candidateId!;
  await createActionLog({
    userId: user.id,
    actionType: "update_interview",
    subjectType: "candidate",
    subjectId,
    metadata: {
      interviewId: input.interviewId,
      from: existing.scheduledAt.toISOString(),
      to: when.toISOString(),
      durationMin: input.durationMin,
      type: input.type,
      notifyMode: input.notifyMode,
    },
  });

  await logActivity({
    organizationId: orgForUpdate.id,
    userId: user.id,
    actionType: "interview_updated",
    targetType: "interview",
    targetId: input.interviewId,
    metadata: {
      candidateRfId: existing.candidateRfId,
      candidateId: existing.candidateId,
      from: existing.scheduledAt.toISOString(),
      to: when.toISOString(),
      durationMin: input.durationMin,
      type: input.type,
      notifyMode: input.notifyMode,
    },
  });

  revalidateForCandidate({ candidateRfId: existing.candidateRfId, candidateId: existing.candidateId });
  return { ok: true };
}

// ---- Send native Google Calendar invite (replaces Gmail send) ----
//
// The composer fields become a Google Calendar event title + description.
// Ace-scheduled interviews intentionally keep two per-party events: one
// client invite and one candidate invite. The first party reuses the
// organizer-only tracking event created at schedule time; the second party
// gets a new event with the same Meet attached. That keeps invite bodies
// separate while avoiding a third duplicate event on Andrew's calendar.

export type SendInvitePartyInput = {
  interviewId: string;
  party: "client" | "candidate";
  attendeeEmail: string;
  attendeeName?: string;
  // All To recipients for this party. The first is the primary attendee
  // (carries attendeeName as its display name); every other To address is
  // added as an additional guest on the calendar event so multi-recipient
  // To invites land for everyone. Falls back to [attendeeEmail] when the
  // caller doesn't pass the array (e.g. the candidate-only invite).
  toEmails?: string[];
  // Optional additional recipients. Client Cc recipients become visible
  // guests on the client calendar event. Google Calendar has no private
  // Bcc bucket, so Bcc recipients (e.g. Austin) are delivered a separate
  // Gmail copy of the invite at send time instead — hidden from the
  // candidate and client. Candidate events stay candidate-only.
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string; // becomes event.summary
  bodyText: string; // becomes event.description
  // Reserved for future use — the event timezone is set on creation
  // so the per-party patch does not need to refresh it.
  timeZone?: string;
};

export type SendInvitePartyResult =
  | {
      ok: true;
      value: {
        googleEventId: string;
        // Canonical Meet link from the Interview row (set at schedule
        // time). Returned so the second composer can render it in the
        // candidate's email body.
        meetLink: string | null;
      };
    }
  | { ok: false; error: string };

export async function sendInterviewInvite(input: SendInvitePartyInput): Promise<SendInvitePartyResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.attendeeEmail.trim()) return { ok: false, error: "Attendee email required." };
  if (!input.subject.trim()) return { ok: false, error: "Event title required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Event description required." };
  const org = await getCurrentOrg();

  const interview = await prisma.interview.findFirst({
    where: { id: input.interviewId, organizationId: org.id },
    select: {
      id: true,
      scheduledAt: true,
      durationMin: true,
      type: true,
      meetLink: true,
      meetConferenceId: true,
      googleEventIdMine: true,
      googleEventIdClient: true,
      googleEventIdCandidate: true,
      candidateRfId: true,
      candidateId: true,
      jobRfId: true,
      jobId: true,
      location: true,
    },
  });
  if (!interview) return { ok: false, error: "Interview not found." };

  // Server-side safety net for [Job Description] — fetch the latest
  // JobOverride and re-resolve any leftover `[Job Description]` tokens
  // in the body the client sent. The client already runs applyMergeFields
  // on send (EmailComposer.mergeValues), but the candidate page that
  // built those values may have been loaded before the recruiter saved
  // the override. Reading right here at send time guarantees the freshest
  // value lands in the calendar event description.
  let resolvedBodyText = input.bodyText;
  let resolvedSubject = input.subject;
  if (resolvedBodyText.includes("[Job Description]") || resolvedSubject.includes("[Job Description]")) {
    // Ace-native interviews carry jobRfId=null and jobId=cuid; pull the
    // description off Job.description in that case instead of the
    // override layer (which only exists for RF-imported jobs).
    const override = interview.jobRfId != null
      ? await prisma.jobOverride.findUnique({
          where: { jobRfId: interview.jobRfId },
          select: { description: true },
        })
      : null;
    const aceJob = interview.jobRfId == null && interview.jobId
      ? await prisma.job.findUnique({
          where: { id: interview.jobId },
          select: { description: true },
        })
      : null;
    const description = override?.description ?? aceJob?.description ?? "";
    resolvedBodyText = resolvedBodyText.split("[Job Description]").join(description);
    resolvedSubject = resolvedSubject.split("[Job Description]").join(description);
  }

  const cc = input.party === "client"
    ? (input.ccEmails ?? []).filter((e) => e && e.trim()).map((e) => ({ email: e.trim() }))
    : [];
  // Every To recipient becomes a guest on the calendar event. The first
  // carries the display name; the rest are added as additional attendees
  // so a multi-recipient To invite reaches everyone, not just draft.to[0].
  // Falls back to the single attendeeEmail for callers (candidate invite)
  // that don't pass the toEmails array.
  const toList = (input.toEmails && input.toEmails.length > 0
    ? input.toEmails
    : [input.attendeeEmail]
  )
    .map((e) => e.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const newAttendees: { email: string; displayName?: string }[] = [];
  for (const email of toList) {
    const key = email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    newAttendees.push({
      email,
      // Only the primary (first) To recipient carries the display name.
      displayName: newAttendees.length === 0 ? input.attendeeName : undefined,
    });
  }
  for (const a of cc) {
    const key = a.email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    newAttendees.push(a);
  }

  const existingPartyEventId =
    input.party === "client" ? interview.googleEventIdClient : interview.googleEventIdCandidate;
  const otherPartyEventId =
    input.party === "client" ? interview.googleEventIdCandidate : interview.googleEventIdClient;
  const sharedPartyEvent =
    Boolean(existingPartyEventId && otherPartyEventId && existingPartyEventId === otherPartyEventId);
  const partyEventId = sharedPartyEvent ? null : existingPartyEventId;
  const title = resolvedSubject.trim();
  const description = resolvedBodyText;
  const googleMeetStored = isGoogleMeetLink(interview.meetLink);
  const calendarLocation =
    interview.location ||
    (interview.type === "video" && interview.meetLink && !googleMeetStored
      ? interview.meetLink
      : undefined);

  let googleEventId: string;
  let effectiveMeetLink = interview.meetLink ?? null;
  let createdMeetLink: string | null = null;
  let createdMeetingCode: string | null = null;

  // If this party already has its own event, update that event in place.
  // If no party invite has shipped yet, reuse the schedule-time tracking
  // event so the first send does not create an extra duplicate block.
  const reusableTrackingEventId =
    !partyEventId && !otherPartyEventId ? interview.googleEventIdMine : null;
  let retiredTrackingEventId: string | null = null;
  let eventToPatch = partyEventId ?? reusableTrackingEventId;
  if (reusableTrackingEventId) {
    try {
      const trackingAttendees = await getCalendarEventAttendees({
        userId: user.id,
        eventId: reusableTrackingEventId,
      });
      if (trackingAttendees.some((a) => a.email.trim().length > 0)) {
        retiredTrackingEventId = reusableTrackingEventId;
        eventToPatch = null;
      }
    } catch {
      // If we cannot prove the tracking event is organizer-only, create a
      // fresh party event instead of risking another cross-party update mail.
      retiredTrackingEventId = reusableTrackingEventId;
      eventToPatch = null;
    }
  }

  if (eventToPatch) {
    try {
      await updateEventAsInvite({
        userId: user.id,
        eventId: eventToPatch,
        summary: title,
        description,
        newAttendees,
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `Calendar invite failed: ${e.message}` : "Calendar invite failed.",
      };
    }
    googleEventId = eventToPatch;
    await updateLocalCalendarEventDetails({
      organizationId: org.id,
      googleEventId,
      title,
      description,
    });
  } else {
    const sourceEventId = otherPartyEventId ?? interview.googleEventIdMine;
    let attachConferenceData: Record<string, unknown> | undefined;
    if (googleMeetStored && sourceEventId) {
      try {
        const src = await getEventConferenceData({ userId: user.id, eventId: sourceEventId });
        if (src) attachConferenceData = src;
      } catch {
        // Fall through to the meeting-code attach path below.
      }
    }

    const createMeet =
      interview.type === "video" &&
      !effectiveMeetLink &&
      !attachConferenceData;
    const attachMeetConferenceId =
      interview.type === "video" && googleMeetStored && !attachConferenceData
        ? interview.meetConferenceId ?? undefined
        : undefined;
    const attachMeetLink =
      interview.type === "video" && googleMeetStored && !attachConferenceData
        ? interview.meetLink ?? undefined
        : undefined;

    try {
      const created = await createCalendarEvent({
        userId: user.id,
        summary: title,
        description,
        startISO: interview.scheduledAt.toISOString(),
        durationMin: interview.durationMin,
        attendees: newAttendees,
        createMeet,
        attachConferenceData,
        attachMeetConferenceId,
        attachMeetLink,
        sendUpdates: true,
        location: calendarLocation || undefined,
        timeZone: input.timeZone,
      });
      googleEventId = created.eventId;
      createdMeetLink = created.meetLink;
      createdMeetingCode = created.meetingCode;
      effectiveMeetLink = effectiveMeetLink ?? created.meetLink ?? attachMeetLink ?? null;
      if (retiredTrackingEventId && retiredTrackingEventId !== googleEventId) {
        try {
          await deleteCalendarEvent({ userId: user.id, eventId: retiredTrackingEventId, sendUpdates: false });
        } catch {
          // Best-effort cleanup; the new per-party invite is the source of truth.
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `Calendar invite failed: ${e.message}` : "Calendar invite failed.",
      };
    }
  }

  const updateData: {
    googleEventIdMine?: string;
    googleEventIdClient?: string;
    googleEventIdCandidate?: string;
    meetLink?: string | null;
    meetConferenceId?: string | null;
    sentCandidateSubject?: string;
    sentCandidateBody?: string;
    sentCandidateAt?: Date;
    sentClientSubject?: string;
    sentClientBody?: string;
    sentClientAt?: Date;
  } = {};
  if (!interview.googleEventIdMine || retiredTrackingEventId) updateData.googleEventIdMine = googleEventId;
  if (input.party === "client") updateData.googleEventIdClient = googleEventId;
  else updateData.googleEventIdCandidate = googleEventId;
  if (!interview.meetLink && createdMeetLink) {
    updateData.meetLink = createdMeetLink;
    updateData.meetConferenceId = createdMeetingCode;
  }
  // D1: store a verbatim copy of EXACTLY what this party was emailed — the
  // same summary (title) + description the calendar invite carries, which
  // is what the recipient saw. `title` and `description` are the values
  // already handed to Google above; we only copy them, never re-derive, so
  // the outgoing invite is untouched. The *At timestamp doubles as the
  // "invite delivered" flag the calendar reads to decide one vs two events.
  const sentAt = new Date();
  if (input.party === "client") {
    updateData.sentClientSubject = title;
    updateData.sentClientBody = description;
    updateData.sentClientAt = sentAt;
  } else {
    updateData.sentCandidateSubject = title;
    updateData.sentCandidateBody = description;
    updateData.sentCandidateAt = sentAt;
  }
  await prisma.interview.updateMany({
    where: { id: input.interviewId, organizationId: org.id },
    data: updateData,
  });

  const subjectId =
    interview.candidateRfId != null ? String(interview.candidateRfId) : interview.candidateId!;
  await createActionLog({
    userId: user.id,
    actionType: input.party === "client" ? "interview_invite_client" : "interview_invite_candidate",
    subjectType: "candidate",
    subjectId,
    metadata: {
      interviewId: interview.id,
      attendeeEmail: input.attendeeEmail,
      eventSummary: input.subject,
      googleEventId,
      meetLink: effectiveMeetLink,
      deliveredVia: "calendar",
    },
  });

  // Phase 4d: ActivityLog audit-feed entry. Interview invites go out
  // via Google Calendar (sendUpdates: all) rather than a raw Gmail
  // send, but from the recruiter's POV they're emails — the
  // "email_sent" tile on the Dashboard counts them. targetType is
  // "interview" (the invite hangs off an Interview row); metadata
  // carries the recipient + subject so per-user activity feeds can
  // render "invited {email} to {subject}" without a join.
  await logActivity({
    organizationId: org.id,
    userId: user.id,
    actionType: "email_sent",
    targetType: "interview",
    targetId: interview.id,
    metadata: {
      kind: "interview_invite",
      party: input.party,
      recipientEmail: input.attendeeEmail,
      subject: input.subject,
      googleEventId,
      deliveredVia: "calendar",
    },
  });

  // Bcc delivery. A Google Calendar invite has no private Bcc bucket, so
  // any Bcc recipient gets a separate Gmail copy of the invite — same
  // subject + description the calendar event carries — sent to them
  // privately (the candidate and client never see it). Best-effort: a
  // copy-send failure never fails the invite the recruiter already sent.
  const bccList = (input.bccEmails ?? [])
    .map((e) => e.trim())
    .filter(Boolean);
  if (bccList.length > 0) {
    try {
      const meetForBody = effectiveMeetLink
        ? `\n\nJoin on Google Meet: ${effectiveMeetLink}`
        : "";
      const copyBody =
        `You've been Bcc'd a private copy of this interview invite. ` +
        `The candidate and client do not see this message.\n\n` +
        `${resolvedBodyText}${meetForBody}`;
      await sendGmail({
        userId: user.id,
        from: user.email,
        fromName: user.name ?? undefined,
        // Send only to the Bcc recipients, hidden from each other via Bcc
        // so multiple private observers never see one another.
        to: [user.email],
        bcc: bccList,
        subject: resolvedSubject,
        bodyText: copyBody,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[interview-invite] bcc copy send failed", {
        interviewId: interview.id,
        party: input.party,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  revalidateForCandidate({ candidateRfId: interview.candidateRfId, candidateId: interview.candidateId });
  return {
    ok: true,
    value: { googleEventId, meetLink: effectiveMeetLink },
  };
}

// Returns the active templates for the two interview-scheduled triggers so
// the per-party composers can pre-populate subject + body when a template
// exists. Returns null for whichever side has no active template; callers
// fall back to the hardcoded composer defaults in that case. Merge fields
// are NOT resolved here — the caller applies applyMergeFields with the
// live interview context so merge values can change between fetch and
// render.
export type InterviewSchedulingTemplate = { subject: string; body: string };
export type InterviewSchedulingTemplates = {
  candidate: InterviewSchedulingTemplate | null;
  client: InterviewSchedulingTemplate | null;
};

// 60-minute lead time so the site-wide amber reminder toast fires an hour
// ahead of every interview without recruiter setup.
const INTERVIEW_REMINDER_LEAD_MS = 60 * 60 * 1000;

function composeCandidateName(first: string | null, last: string | null): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "Candidate";
}

// Fire-and-forget side effect from every schedule + reschedule callsite.
// Looks up the Interview row, builds a title from candidate + client,
// and upserts an AceReminder keyed on interviewId so reschedule shifts
// the existing row's reminderAt instead of stacking duplicates. Any
// failure swallows silently — the recruiter already saw the schedule
// succeed and the reminder is a convenience, not a primary side effect.
export async function upsertInterviewReminder(interviewId: string): Promise<void> {
  if (!interviewId) return;
  const user = await requireUser();
  if (!user) return;
  try {
    const iv = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true,
        scheduledAt: true,
        organizationId: true,
        candidateRfId: true,
        candidateId: true,
        clientRfId: true,
        clientId: true,
      },
    });
    if (!iv) return;

    let candidateName = "Candidate";
    if (iv.candidateId) {
      const c = await prisma.candidate.findUnique({
        where: { id: iv.candidateId },
        select: { firstName: true, lastName: true },
      });
      if (c) candidateName = composeCandidateName(c.firstName, c.lastName);
    } else if (iv.candidateRfId != null) {
      const c = await prisma.candidate.findUnique({
        where: { rfId: iv.candidateRfId },
        select: { firstName: true, lastName: true },
      });
      if (c) candidateName = composeCandidateName(c.firstName, c.lastName);
    }

    let companyName = "Client";
    if (iv.clientId) {
      const cl = await prisma.client.findUnique({
        where: { id: iv.clientId },
        select: { name: true },
      });
      if (cl?.name) companyName = cl.name;
    } else if (iv.clientRfId != null) {
      const cl = await prisma.client.findUnique({
        where: { legacyRfId: iv.clientRfId },
        select: { name: true, organizationId: true },
      });
      if (cl?.name && cl.organizationId === iv.organizationId) companyName = cl.name;
    }

    const title = `Interview: ${candidateName} - ${companyName}`;
    const reminderAt = new Date(iv.scheduledAt.getTime() - INTERVIEW_REMINDER_LEAD_MS);

    // Same findFirst + update-or-create shape used by the calendar event
    // drawer reminder path (src/app/calendar/event-actions.ts:218). Scope
    // to non-dismissed rows so a previously dismissed reminder for the
    // same interview is not silently revived.
    const existing = await prisma.aceReminder.findFirst({
      where: { interviewId, dismissed: false },
      select: { id: true },
    });
    if (existing) {
      await prisma.aceReminder.update({
        where: { id: existing.id },
        data: { title, reminderAt, notifyLeadsMin: [0], notifiedLeadsMin: [] },
      });
    } else {
      await prisma.aceReminder.create({
        data: {
          organizationId: iv.organizationId,
          userId: user.id,
          title,
          reminderAt,
          interviewId,
          // reminderAt is already the exact fire time, so no lead.
          notifyLeadsMin: [0],
        },
      });
    }
  } catch {
    // best-effort — never break the schedule flow on reminder failure
  }
}

export async function getInterviewSchedulingTemplates(): Promise<InterviewSchedulingTemplates> {
  const user = await requireUser();
  if (!user) return { candidate: null, client: null };
  const [candidate, client] = await Promise.all([
    prisma.emailTemplate.findFirst({
      where: { trigger: CANDIDATE_INTERVIEW_PREP_TRIGGER, isActive: true },
      select: { subject: true, body: true },
    }),
    prisma.emailTemplate.findFirst({
      where: { trigger: CLIENT_INTERVIEW_SCHEDULED_TRIGGER, isActive: true },
      select: { subject: true, body: true },
    }),
  ]);
  return {
    candidate: candidate ? { subject: candidate.subject, body: candidate.body } : null,
    client: client ? { subject: client.subject, body: client.body } : null,
  };
}
