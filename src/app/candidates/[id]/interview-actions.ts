"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
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
  // Summary/description for the calendar event and candidate-facing activity log.
  jobTitle?: string;
  clientName?: string;
  candidateName?: string;
};

export type ScheduleInterviewResult =
  | { ok: true; value: { interviewId: string; meetLink: string | null; calendarEventId: string | null } }
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
  // - ace_scheduled: add to creator's calendar for tracking. We do NOT invite
  //   candidate/client from this call; that's the templated-email path, and
  //   the richer invite-with-attendees flow lands in the next batch.
  // - client_scheduled: the client is sending their own invite. We put the
  //   event on the creator's calendar ONLY, no attendee emails.
  // Meet link auto-creation is enabled for video regardless of source.
  let calendarEventId: string | null = null;
  let meetLink: string | null = null;
  try {
    const ev = await createCalendarEvent({
      userId: user.id,
      summary: calendarSummary(input),
      description: calendarDescription(input),
      startISO: when.toISOString(),
      durationMin: input.durationMin,
      attendees: [],
      createMeet: input.type === "video",
      sendUpdates: false,
    });
    calendarEventId = ev.eventId;
    meetLink = ev.meetLink;
  } catch (e) {
    // Non-fatal: we still record the interview to the DB. The UI surfaces
    // the calendar failure as a toast so the user can retry or wire up
    // calendar scope.
    return {
      ok: false,
      error: e instanceof Error ? `Calendar create failed: ${e.message}` : "Calendar create failed.",
    };
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
        notes: input.notes || null,
        status: "scheduled",
        source: input.source,
        calendarEventId,
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
          calendarEventId,
          local: ref.candidateId != null,
        },
      },
    });

    revalidateForCandidate(ref);
    return { ok: true, value: { interviewId: interview.id, meetLink, calendarEventId } };
  } catch (e) {
    // Roll back the calendar event if the DB write fails — we don't want an
    // orphan calendar entry.
    if (calendarEventId) {
      try {
        await deleteCalendarEvent({ userId: user.id, eventId: calendarEventId, sendUpdates: false });
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
      select: { id: true, status: true, calendarEventId: true, candidateRfId: true, candidateId: true },
    });
    if (!existing) return { ok: false, error: "Interview not found." };
    if (existing.status === "cancelled") return { ok: true };

    if (existing.calendarEventId) {
      try {
        await deleteCalendarEvent({ userId: user.id, eventId: existing.calendarEventId, sendUpdates: false });
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
        calendarEventId: true,
        candidateRfId: true,
        candidateId: true,
      },
    });
    if (!existing) return { ok: false, error: "Interview not found." };
    if (existing.status === "cancelled") return { ok: false, error: "Can't reschedule a cancelled interview." };

    const durationMin = input.durationMin && input.durationMin > 0 ? input.durationMin : existing.durationMin;

    if (existing.calendarEventId) {
      try {
        await updateCalendarEvent({
          userId: user.id,
          eventId: existing.calendarEventId,
          startISO: when.toISOString(),
          durationMin,
          sendUpdates: false,
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
