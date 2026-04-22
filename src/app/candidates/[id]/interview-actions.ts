"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addAttendeeToEvent,
  createCalendarEvent,
  deleteCalendarEvent,
  setMeetOpenAccess,
  updateCalendarEvent,
  updateEventAsInvite,
} from "@/lib/google-calendar";

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

export type InterviewAttendee = { id?: number; name: string; email: string };

export type ScheduleInterviewInput = {
  // Exactly one of the two identifiers is set.
  candidateRfId?: number | null;
  candidateId?: string | null;
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
  jobRfId: number;
  clientRfId: number;
  userId: string;
}) {
  const whereUnique = args.candidateRfId != null
    ? { candidateRfId_jobRfId: { candidateRfId: args.candidateRfId, jobRfId: args.jobRfId } }
    : { candidateId_jobRfId: { candidateId: args.candidateId!, jobRfId: args.jobRfId } };
  const existing = await prisma.placement.findUnique({ where: whereUnique, select: { id: true, stage: true } });
  if (!existing) {
    await prisma.placement.create({
      data: {
        candidateRfId: args.candidateRfId,
        candidateId: args.candidateId,
        jobRfId: args.jobRfId,
        clientRfId: args.clientRfId,
        stage: "interviewing",
        createdById: args.userId,
        syncedToRf: false,
      },
    });
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
}

function calendarSummary(input: ScheduleInterviewInput): string {
  const who = input.candidateName || "Candidate";
  const job = input.jobTitle || "role";
  const client = input.clientName ? ` (${input.clientName})` : "";
  const kind =
    input.type === "phone_screen" ? "Phone Screen" : input.type === "video" ? "Interview" : "Onsite";
  return `${kind}: ${who} — ${job}${client}`;
}

function calendarDescription(input: ScheduleInterviewInput): string {
  const lines: string[] = [];
  if (input.candidateName) lines.push(`Candidate: ${input.candidateName}`);
  if (input.jobTitle) lines.push(`Role: ${input.jobTitle}`);
  if (input.clientName) lines.push(`Client: ${input.clientName}`);
  if (input.candidatePhone) lines.push(`Candidate phone: ${input.candidatePhone}`);
  if (input.location) lines.push(`Location: ${input.location}`);
  if (input.attendees && input.attendees.length > 0) {
    lines.push(`Interviewers: ${input.attendees.map((a) => `${a.name}${a.email ? ` <${a.email}>` : ""}`).join(", ")}`);
  }
  if (input.notes) lines.push("", input.notes);
  lines.push("", "Logged from Ace (BreakPoint Talent CRM).");
  return lines.join("\n");
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
  // - ace_scheduled: create the event on the creator's primary calendar
  //   with ONLY the creator. The candidate and client are added later via
  //   their respective email composers (which send the custom-templated
  //   emails); that's where the googleEventIdClient / googleEventIdCandidate
  //   columns get populated.
  // - client_scheduled: the client is sending their own invite. We put the
  //   event on the creator's calendar ONLY, and no emails go out.
  // Meet link auto-creation is enabled for video regardless of source.
  // Calendar behavior:
  // - ace_scheduled: save DB only. The Google events for the interview are
  //   created later, one per attendee, when each invite composer sends.
  //   That way client and candidate each get their own event/invite and
  //   don't see each other on the attendee list.
  // - client_scheduled: tracking event on creator's calendar (no attendees,
  //   no emails, no Meet). Recruiter just wants it on their schedule while
  //   the client sends their own invite.
  let googleEventIdMine: string | null = null;
  const meetLink: string | null = null;
  if (input.source === "client_scheduled") {
    try {
      const ev = await createCalendarEvent({
        userId: user.id,
        summary: calendarSummary(input),
        description: calendarDescription(input),
        startISO: when.toISOString(),
        durationMin: input.durationMin,
        attendees: [],
        createMeet: false,
        sendUpdates: false,
        location: input.location || undefined,
      });
      googleEventIdMine = ev.eventId;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `Calendar create failed: ${e.message}` : "Calendar create failed.",
      };
    }
  }

  try {
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
        clientAttendees: input.attendees && input.attendees.length > 0 ? (input.attendees as object) : undefined,
        candidatePhone: input.candidatePhone || null,
        location: input.location || null,
        notes: input.notes || null,
        status: "scheduled",
        source: input.source,
        googleEventIdMine,
        createdById: user.id,
      },
      select: { id: true },
    });

    await upsertInterviewingStage({
      candidateRfId: ref.candidateRfId,
      candidateId: ref.candidateId,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      userId: user.id,
    });

    const subjectId = ref.candidateRfId != null ? String(ref.candidateRfId) : ref.candidateId!;
    await prisma.actionLog.create({
      data: {
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
      },
    });

    revalidateForCandidate(ref);
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

export async function cancelInterview(interviewId: string): Promise<Result> {
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

    // Delete every Google event tied to this interview. Invite events go out
    // with sendUpdates="all" so Google sends cancellation emails to the
    // attendees. The tracking event (client_scheduled only) has no
    // attendees, so sendUpdates has no effect there.
    const eventIds = [
      { id: existing.googleEventIdMine, notify: false },
      { id: existing.googleEventIdClient, notify: true },
      { id: existing.googleEventIdCandidate, notify: true },
    ];
    for (const ev of eventIds) {
      if (!ev.id) continue;
      try {
        await deleteCalendarEvent({ userId: user.id, eventId: ev.id, sendUpdates: ev.notify });
      } catch {
        // best-effort
      }
    }

    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "cancelled" },
    });

    const subjectId = existing.candidateRfId != null ? String(existing.candidateRfId) : existing.candidateId!;
    await prisma.actionLog.create({
      data: {
        userId: user.id,
        actionType: "cancel_interview",
        subjectType: "candidate",
        subjectId,
        metadata: { interviewId },
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

    // Push the new time to every related Google event. Invite events notify
    // attendees (RSVP mail); tracking event is silent.
    const eventIds = [
      { id: existing.googleEventIdMine, notify: false },
      { id: existing.googleEventIdClient, notify: true },
      { id: existing.googleEventIdCandidate, notify: true },
    ];
    for (const ev of eventIds) {
      if (!ev.id) continue;
      try {
        await updateCalendarEvent({
          userId: user.id,
          eventId: ev.id,
          startISO: when.toISOString(),
          durationMin,
          sendUpdates: ev.notify,
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

    const subjectId = existing.candidateRfId != null ? String(existing.candidateRfId) : existing.candidateId!;
    await prisma.actionLog.create({
      data: {
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
      },
    });

    revalidateForCandidate({ candidateRfId: existing.candidateRfId, candidateId: existing.candidateId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reschedule failed." };
  }
}

// ---- Send native Google Calendar invite (replaces Gmail send) ----
//
// The "email composer" UI is really a calendar event editor in disguise:
// the subject field writes to event.summary, the body field writes to
// event.description, and sending PATCHes the event while adding the
// attendee with sendUpdates="all" so Google ships the native ICS invite
// (Accept / Maybe / Decline) instead of a free-form email.
//
// One event, two invites: when the client invite sends, both the
// existing creator and the newly-added client get updated; when the
// candidate invite sends, the client + candidate + creator all get the
// final version. Google handles the diff.

export type SendInvitePartyInput = {
  interviewId: string;
  party: "client" | "candidate";
  attendeeEmail: string;
  attendeeName?: string;
  // Optional additional recipients. Both events (client + candidate) get
  // the same cc/bcc — recruiter's choice up-front. Google Calendar treats
  // these as attendees with responseStatus=needsAction.
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string; // becomes event.summary
  bodyText: string; // becomes event.description
};

export type SendInvitePartyResult =
  | {
      ok: true;
      value: {
        googleEventId: string;
        // Effective Meet link for this interview after the send completes.
        // For the first party through (typically client), this is the
        // freshly-minted Meet link from Google's response. For the second
        // party, it's the same link re-attached to their event. Returned
        // so the caller can thread it into the next-party composer so the
        // candidate's email body shows the join URL explicitly rather
        // than relying solely on Gmail rendering the native calendar
        // invite's Join-with-Meet button.
        meetLink: string | null;
        // Surfaces when we asked Google Meet to set accessType=OPEN and the
        // API rejected it (most often because the meetings.space.settings
        // OAuth scope isn't on the user's token). The interview itself is
        // still valid; the Meet just falls back to its default TRUSTED
        // access until the user re-grants the scope and we retry.
        meetAccessWarning?: { reason: string; message: string };
      };
    }
  | { ok: false; error: string };

export async function sendInterviewInvite(input: SendInvitePartyInput): Promise<SendInvitePartyResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.attendeeEmail.trim()) return { ok: false, error: "Attendee email required." };
  if (!input.subject.trim()) return { ok: false, error: "Event title required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Event description required." };

  const interview = await prisma.interview.findUnique({
    where: { id: input.interviewId },
    select: {
      id: true,
      scheduledAt: true,
      durationMin: true,
      type: true,
      meetLink: true,
      meetConferenceId: true,
      googleEventIdClient: true,
      googleEventIdCandidate: true,
      candidateRfId: true,
      candidateId: true,
      jobRfId: true,
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
    const override = await prisma.jobOverride.findUnique({
      where: { jobRfId: interview.jobRfId },
      select: { description: true },
    });
    const description = override?.description ?? "";
    // eslint-disable-next-line no-console
    console.log("[sendInterviewInvite] resolving [Job Description] server-side", {
      interviewId: input.interviewId,
      jobRfId: interview.jobRfId,
      hasOverride: Boolean(override),
      descLength: description.length,
    });
    resolvedBodyText = resolvedBodyText.split("[Job Description]").join(description);
    resolvedSubject = resolvedSubject.split("[Job Description]").join(description);
  }

  const needsMeet = interview.type === "video";
  const hasExistingMeet = Boolean(interview.meetLink && interview.meetConferenceId);
  // If the other party's event has already been created, we reuse its Meet.
  // First party through creates a fresh Meet.
  const createMeet = needsMeet && !hasExistingMeet;
  const attachMeetConferenceId = needsMeet && hasExistingMeet ? interview.meetConferenceId ?? undefined : undefined;
  const attachMeetLink = needsMeet && hasExistingMeet ? interview.meetLink ?? undefined : undefined;

  // Merge the primary attendee with any cc emails (calendar treats them
  // identically). Bcc emails are distinct in email semantics but Google
  // Calendar doesn't have a bcc concept — we honor the recruiter's intent
  // by adding them with responseStatus=needsAction and NOT surfacing them
  // in the visible guest list. That's as close to bcc as the API supports.
  const cc = (input.ccEmails ?? []).filter((e) => e && e.trim()).map((e) => ({ email: e.trim() }));
  const bcc = (input.bccEmails ?? []).filter((e) => e && e.trim()).map((e) => ({ email: e.trim() }));
  const primary = { email: input.attendeeEmail, displayName: input.attendeeName };
  // Dedupe by lowercase email so we don't add the primary attendee twice.
  const seen = new Set<string>([input.attendeeEmail.toLowerCase()]);
  const extras: { email: string; displayName?: string }[] = [];
  for (const a of [...cc, ...bcc]) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(a);
  }
  let created: { eventId: string; meetLink: string | null; meetingCode: string | null };
  // Candidate invite path — join the client's existing event instead of
  // creating a parallel event. The old "second createCalendarEvent with
  // attached conferenceData" path rendered the Meet as a plain-text URL
  // inside Gmail for some recipients instead of the native "Join with
  // Google Meet" widget. Adding the candidate as an attendee on the
  // client's event + PATCHing summary/description uses the same
  // first-class event that gave the client the native widget, so the
  // candidate sees exactly that too.
  if (input.party === "candidate" && interview.googleEventIdClient) {
    try {
      // updateEventAsInvite does GET → merge attendees → PATCH with
      // sendUpdates=all in one round-trip. It also patches summary +
      // description so the recruiter's candidate-side framing wins on
      // the shared event. Google sends a native invite email to the
      // newly-added attendee (candidate) and an "event updated"
      // notification to the existing attendees (client + earlier cc/bcc).
      await updateEventAsInvite({
        userId: user.id,
        eventId: interview.googleEventIdClient,
        summary: resolvedSubject.trim(),
        description: resolvedBodyText,
        newAttendee: { email: primary.email, displayName: primary.displayName },
      });
      // cc/bcc still need to land on the event. addAttendeeToEvent is a
      // separate GET→PATCH per attendee — fine for the small sizes we
      // expect here (typically <5 cc/bcc combined).
      for (const a of extras) {
        await addAttendeeToEvent({
          userId: user.id,
          eventId: interview.googleEventIdClient,
          attendee: { email: a.email, displayName: a.displayName },
          sendUpdates: true,
        });
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `Calendar invite failed: ${e.message}` : "Calendar invite failed.",
      };
    }

    await prisma.interview.update({
      where: { id: input.interviewId },
      data: { googleEventIdCandidate: interview.googleEventIdClient },
    });

    const subjectId =
      interview.candidateRfId != null ? String(interview.candidateRfId) : interview.candidateId!;
    await prisma.actionLog.create({
      data: {
        userId: user.id,
        actionType: "interview_invite_candidate",
        subjectType: "candidate",
        subjectId,
        metadata: {
          interviewId: interview.id,
          attendeeEmail: input.attendeeEmail,
          eventSummary: input.subject,
          googleEventId: interview.googleEventIdClient,
          meetLink: interview.meetLink,
          deliveredVia: "calendar_attendee_add",
        },
      },
    });

    revalidateForCandidate({ candidateRfId: interview.candidateRfId, candidateId: interview.candidateId });
    return {
      ok: true,
      value: {
        googleEventId: interview.googleEventIdClient,
        meetLink: interview.meetLink ?? null,
      },
    };
  }

  try {
    const ev = await createCalendarEvent({
      userId: user.id,
      summary: resolvedSubject.trim(),
      description: resolvedBodyText,
      startISO: interview.scheduledAt.toISOString(),
      durationMin: interview.durationMin,
      attendees: [primary, ...extras],
      createMeet,
      attachMeetConferenceId,
      attachMeetLink,
      sendUpdates: true,
      location: interview.location || undefined,
    });
    created = { eventId: ev.eventId, meetLink: ev.meetLink, meetingCode: ev.meetingCode };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Calendar invite failed: ${e.message}` : "Calendar invite failed.",
    };
  }

  // Flip the newly-created Meet to OPEN access so anyone with the link can
  // join without host approval. Fail soft — if the Meet scope isn't granted
  // the invite still works; we surface the reason to the UI so the user
  // knows to re-grant.
  let meetAccessWarning: { reason: string; message: string } | undefined;
  if (createMeet && created.meetingCode) {
    const meetResult = await setMeetOpenAccess({ userId: user.id, meetingCode: created.meetingCode });
    if (!meetResult.ok) {
      console.warn(
        `[sendInterviewInvite] Meet open-access flip failed: reason=${meetResult.reason} error=${meetResult.error}`,
      );
      meetAccessWarning = { reason: meetResult.reason, message: meetResult.error };
    } else {
      console.log(`[sendInterviewInvite] Meet access set to OPEN for ${created.meetingCode} (HTTP ${meetResult.status})`);
    }
  }

  // Persist: the per-party event id, and (on first invite only) the Meet
  // identity so the second invite can attach the same Meet.
  const updateData: {
    googleEventIdClient?: string;
    googleEventIdCandidate?: string;
    meetLink?: string | null;
    meetConferenceId?: string | null;
  } = {};
  if (input.party === "client") updateData.googleEventIdClient = created.eventId;
  else updateData.googleEventIdCandidate = created.eventId;
  if (createMeet && created.meetLink) {
    updateData.meetLink = created.meetLink;
    updateData.meetConferenceId = created.meetingCode ?? null;
  }
  await prisma.interview.update({ where: { id: input.interviewId }, data: updateData });

  const subjectId =
    interview.candidateRfId != null ? String(interview.candidateRfId) : interview.candidateId!;
  await prisma.actionLog.create({
    data: {
      userId: user.id,
      actionType: input.party === "client" ? "interview_invite_client" : "interview_invite_candidate",
      subjectType: "candidate",
      subjectId,
      metadata: {
        interviewId: interview.id,
        attendeeEmail: input.attendeeEmail,
        eventSummary: input.subject,
        googleEventId: created.eventId,
        meetLink: created.meetLink,
        deliveredVia: "calendar",
      },
    },
  });

  revalidateForCandidate({ candidateRfId: interview.candidateRfId, candidateId: interview.candidateId });
  // Prefer the persisted meetLink when this call re-attached an existing
  // Meet (second party) — that's the canonical Interview.meetLink value.
  // Fall back to what Google returned on the create path (first party) and
  // finally to whatever we had attached into the request.
  const effectiveMeetLink =
    updateData.meetLink ?? interview.meetLink ?? created.meetLink ?? attachMeetLink ?? null;
  return {
    ok: true,
    value: { googleEventId: created.eventId, meetLink: effectiveMeetLink, meetAccessWarning },
  };
}
