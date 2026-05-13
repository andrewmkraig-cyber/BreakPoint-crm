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
  patchCalendarEventDetails,
  updateCalendarEvent,
  updateEventAsInvite,
} from "@/lib/google-calendar";
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
  // IANA timezone the recruiter picked for this interview. Threaded into
  // the tracking event (client_scheduled) and forwarded back to the
  // invite flow so the per-party events use the same zone.
  timeZone?: string;
  // When true (default), the Meet is created with Open access + guests
  // can invite others. When false, guests are locked to the invite list.
  openMeeting?: boolean;
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
  organizationId: string;
}) {
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
  // - ace_scheduled: create one event on the creator's primary calendar
  //   with ONLY the organizer (no attendees yet) + a Meet for video
  //   interviews. The candidate and client are added later via their
  //   respective Send Invite composers — each Send patches THIS event
  //   to add the attendee with sendUpdates="all", so Google ships the
  //   native ICS invite (Accept / Maybe / Decline) per party.
  // - client_scheduled: the client is sending their own invite. We put a
  //   tracking event on the creator's calendar (no attendees, no Meet),
  //   and no emails go out.
  let googleEventIdMine: string | null = null;
  let meetLink: string | null = null;
  let meetConferenceId: string | null = null;
  try {
    const ev = await createCalendarEvent({
      userId: user.id,
      summary: calendarSummary(input),
      description: calendarDescription(input),
      startISO: when.toISOString(),
      durationMin: input.durationMin,
      attendees: [],
      // Video interviews get a Meet on the organizer-only event. The
      // standard Calendar createRequest mints an open-by-default link
      // for the user's workspace (no Meet spaces.patch needed).
      createMeet: input.source === "ace_scheduled" && input.type === "video",
      sendUpdates: false,
      location: input.location || undefined,
      timeZone: input.timeZone,
      openMeeting: input.openMeeting ?? true,
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

    // Delete every Google event tied to this interview. After the
    // native-invites refactor, ace_scheduled interviews keep one shared
    // event (googleEventIdMine == googleEventIdClient/Candidate after
    // each Send Invite), so dedupe here to avoid double DELETEs.
    // Notify when ANY party was added (i.e. an invite went out) — Google
    // emails the cancellation to the attendees in that case.
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
        await deleteCalendarEvent({ userId: user.id, eventId: id, sendUpdates: anyInviteSent });
      } catch {
        // best-effort
      }
    }

    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "cancelled" },
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
    const org = await getCurrentOrg();
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

    // Push the new time to every related Google event. After the native-
    // invites refactor, ace_scheduled interviews keep one shared event
    // across the three googleEventId* columns, so dedupe to avoid
    // PATCHing it more than once (each PATCH with sendUpdates=all would
    // re-notify attendees). Notify when ANY party was invited.
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

// ---- Update interview (full edit) ----
//
// Used by the edit-interview modal which needs to mutate every field a
// recruiter can change (time, duration, type, location, interviewer, etc.)
// AND offer two notify modes:
//
//   - notifyMode: "all"      — patches the calendar event with sendUpdates
//                              "all", so Google emails every attendee an
//                              update.
//   - notifyMode: "new_only" — patches non-attendee fields silently
//                              (sendUpdates "none"), then patches the
//                              attendee list adding only the new attendees
//                              with sendUpdates "all". Existing attendees
//                              see their calendar event update silently;
//                              new attendees get a fresh invitation email.
//
// The "interviewer" field in the modal is the primary client attendee.
// Additional attendees would be plumbed via input.attendees in the future.

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
  notifyMode: "all" | "new_only";
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

  // De-dupe the per-party event-id columns: ace_scheduled interviews
  // share one event across all three columns after invite delivery, so
  // PATCHing the same id three times would trigger three notifications.
  const allEventIds = [
    existing.googleEventIdMine,
    existing.googleEventIdClient,
    existing.googleEventIdCandidate,
  ].filter((id): id is string => Boolean(id));
  const uniqueEventIds = Array.from(new Set(allEventIds));

  try {
    for (const eventId of uniqueEventIds) {
      if (input.notifyMode === "all") {
        // Single PATCH; let Google email everyone the diff. When the
        // attendees array isn't included in the body, the existing
        // guest list is preserved — we only force-update the time and
        // header fields here. Adding a new interviewer via the modal
        // is handled below via addAttendeeToEvent.
        await patchCalendarEventDetails({
          userId: user.id,
          eventId,
          sendUpdates: "all",
          startISO: when.toISOString(),
          durationMin: input.durationMin,
          timeZone: input.timeZone,
          location: input.location ?? "",
        });
      } else {
        // Silent field patch first, then opt-in invitations for new
        // attendees only. Existing attendees see their event update
        // silently; new ones get a fresh invitation email.
        await patchCalendarEventDetails({
          userId: user.id,
          eventId,
          sendUpdates: "none",
          startISO: when.toISOString(),
          durationMin: input.durationMin,
          timeZone: input.timeZone,
          location: input.location ?? "",
        });
      }

      // Compute new attendees and add them with sendUpdates="all" so
      // only the newly-added attendees receive an invitation. Skip
      // empty / malformed entries.
      if (input.attendees && input.attendees.length > 0) {
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
            sendUpdates: "all",
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

  await prisma.interview.update({
    where: { id: input.interviewId },
    data: {
      scheduledAt: when,
      durationMin: input.durationMin,
      type: input.type,
      location: input.location ?? null,
      candidatePhone: input.candidatePhone ?? null,
      notes: input.notes ?? null,
      ...(clientAttendeesJson !== undefined ? { clientAttendees: clientAttendeesJson } : {}),
      status: "scheduled",
    },
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

  const org = await getCurrentOrg();
  await logActivity({
    organizationId: org.id,
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
  // Optional additional recipients. The same event is patched both
  // times — recruiter's cc/bcc choices on each send get appended as
  // attendees. Google Calendar has no bcc concept; closest we can do
  // is add them as needsAction attendees.
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string; // becomes event.summary
  bodyText: string; // becomes event.description
  // Reserved for future use — the event timezone is set on creation
  // so the per-party patch does not need to refresh it.
  timeZone?: string;
  // Reserved for future use — Meet access is set on event creation via
  // conferenceData createRequest; no per-party flip.
  openMeeting?: boolean;
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

  const interview = await prisma.interview.findUnique({
    where: { id: input.interviewId },
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
  if (!interview.googleEventIdMine) {
    return { ok: false, error: "No calendar event on this interview — re-schedule to create one." };
  }

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

  const cc = (input.ccEmails ?? []).filter((e) => e && e.trim()).map((e) => ({ email: e.trim() }));
  const bcc = (input.bccEmails ?? []).filter((e) => e && e.trim()).map((e) => ({ email: e.trim() }));
  const primary = { email: input.attendeeEmail.trim(), displayName: input.attendeeName };
  const seen = new Set<string>([primary.email.toLowerCase()]);
  const newAttendees: { email: string; displayName?: string }[] = [primary];
  for (const a of [...cc, ...bcc]) {
    const key = a.email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    newAttendees.push(a);
  }

  try {
    await updateEventAsInvite({
      userId: user.id,
      eventId: interview.googleEventIdMine,
      summary: resolvedSubject.trim(),
      description: resolvedBodyText,
      newAttendees,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Calendar invite failed: ${e.message}` : "Calendar invite failed.",
    };
  }

  // Mark this party as invited by mirroring the event id into the per-
  // party column. Cancel/reschedule still iterate these columns and
  // dedupe by event id so the same event is only deleted/updated once.
  const updateData: { googleEventIdClient?: string; googleEventIdCandidate?: string } = {};
  if (input.party === "client") updateData.googleEventIdClient = interview.googleEventIdMine;
  else updateData.googleEventIdCandidate = interview.googleEventIdMine;
  await prisma.interview.update({ where: { id: input.interviewId }, data: updateData });

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
      googleEventId: interview.googleEventIdMine,
      meetLink: interview.meetLink,
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
  const org = await getCurrentOrg();
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
      googleEventId: interview.googleEventIdMine,
      deliveredVia: "calendar",
    },
  });

  revalidateForCandidate({ candidateRfId: interview.candidateRfId, candidateId: interview.candidateId });
  return {
    ok: true,
    value: { googleEventId: interview.googleEventIdMine, meetLink: interview.meetLink ?? null },
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
