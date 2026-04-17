"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";
import { generateSubmittalWriteup, type SubmittalInput } from "@/lib/claude";
import { createGmailDraft, plainToHtml, sendGmail } from "@/lib/gmail";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: s.user.email }, select: { id: true } });
  return u?.id ?? null;
}

// General rule: always attempt RF sync for stage changes; fall back to
// Ace-only when RF can't accept the new stage. This helper is the single
// choke point — flip its body to a real API call the moment RF exposes a
// stage-change endpoint, and every action below gets sync for free.
//
// Current state (2026-04-16): RF /external returns 404 on every plausible
// stage-change URL shape, and POST /candidate/update with a jobs array
// returns {RESULT: "SUCCESS"} but silently ignores stage_name changes
// (verified end-to-end). So this helper always reports `synced: false`
// with a short reason; the UI surfaces that as an "(Ace only)" badge.
async function trySyncRfStage(args: {
  candidateRfId: number;
  jobRfId: number;
  aceStage: "offer" | "pending_start" | "hired";
}): Promise<{ synced: boolean; reason: string | null }> {
  void args; // keep the param surface so a future real sync call is a one-line flip
  return {
    synced: false,
    reason: "RF /external doesn't expose pipeline stage changes — Ace-only.",
  };
}

// ---- Offer Received ----

export type RecordOfferInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  salary: number | null;
  currency: string;
  title: string;
  startDate: string | null; // ISO date
  notes: string;
};

export async function recordOffer(input: RecordOfferInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const startDate = input.startDate ? new Date(input.startDate) : null;

  const sync = await trySyncRfStage({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    aceStage: "offer",
  });

  try {
    const row = await prisma.placement.upsert({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        stage: "offer",
        offerReceivedAt: new Date(),
        offerSalary: input.salary ?? null,
        offerCurrency: input.currency || "USD",
        offerTitle: input.title || null,
        offerStartDate: startDate,
        offerNotes: input.notes || null,
        syncedToRf: sync.synced,
        createdById: userId,
      },
      update: {
        stage: "offer",
        offerReceivedAt: new Date(),
        offerSalary: input.salary ?? null,
        offerCurrency: input.currency || "USD",
        offerTitle: input.title || null,
        offerStartDate: startDate,
        offerNotes: input.notes || null,
        syncedToRf: sync.synced,
      },
      select: { id: true, syncedToRf: true },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true, value: { id: row.id, syncedToRf: row.syncedToRf } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to record offer." };
  }
}

// ---- Placement (offer accepted) ----

export type RecordPlacementInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  acceptedSalary: number;
  acceptedCurrency: string;
  feePercentage: number;
  feeTotal: number;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  billingContactName: string;
  billingContactEmail: string;
  hiringManagerName: string;
  hiringManagerEmail: string;
  expectedStartDate: string; // ISO
  notes: string;
};

export async function recordPlacement(input: RecordPlacementInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.expectedStartDate) return { ok: false, error: "Expected start date is required." };

  const sync = await trySyncRfStage({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    aceStage: "pending_start",
  });

  try {
    const row = await prisma.placement.upsert({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        stage: "pending_start",
        placedAt: new Date(),
        acceptedSalary: input.acceptedSalary,
        acceptedCurrency: input.acceptedCurrency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
        guaranteePeriodDays: input.guaranteePeriodDays,
        billingContactName: input.billingContactName || null,
        billingContactEmail: input.billingContactEmail || null,
        hiringManagerName: input.hiringManagerName || null,
        hiringManagerEmail: input.hiringManagerEmail || null,
        expectedStartDate: new Date(input.expectedStartDate),
        placementNotes: input.notes || null,
        syncedToRf: sync.synced,
        createdById: userId,
      },
      update: {
        stage: "pending_start",
        placedAt: new Date(),
        acceptedSalary: input.acceptedSalary,
        acceptedCurrency: input.acceptedCurrency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
        guaranteePeriodDays: input.guaranteePeriodDays,
        billingContactName: input.billingContactName || null,
        billingContactEmail: input.billingContactEmail || null,
        hiringManagerName: input.hiringManagerName || null,
        hiringManagerEmail: input.hiringManagerEmail || null,
        expectedStartDate: new Date(input.expectedStartDate),
        placementNotes: input.notes || null,
        syncedToRf: sync.synced,
      },
      select: { id: true, syncedToRf: true },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true, value: { id: row.id, syncedToRf: row.syncedToRf } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to record placement." };
  }
}

// ---- Confirm Start ----

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4MB — fits under Vercel Hobby 4.5MB

export type ConfirmStartInput = {
  placementId: string;
  screenshotBase64: string; // data:mime;base64,xxx OR just base64
  mimeType: string;
};

export async function confirmStart(input: ConfirmStartInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const rawBase64 = input.screenshotBase64.includes(",")
    ? input.screenshotBase64.split(",")[1]
    : input.screenshotBase64;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(rawBase64, "base64");
  } catch {
    return { ok: false, error: "Couldn't decode screenshot." };
  }
  if (buffer.byteLength === 0) return { ok: false, error: "Screenshot is empty." };
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
    return { ok: false, error: `Screenshot too large (max ${MAX_SCREENSHOT_BYTES / (1024 * 1024)}MB).` };
  }

  try {
    const placement = await prisma.placement.findUnique({ where: { id: input.placementId }, select: { candidateRfId: true } });
    if (!placement) return { ok: false, error: "Placement not found." };

    const existing = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: { jobRfId: true, candidateRfId: true },
    });
    const sync = existing
      ? await trySyncRfStage({
          candidateRfId: existing.candidateRfId,
          jobRfId: existing.jobRfId,
          aceStage: "hired",
        })
      : { synced: false, reason: null };

    await prisma.placement.update({
      where: { id: input.placementId },
      data: {
        stage: "hired",
        startConfirmedAt: new Date(),
        startConfirmationFile: new Uint8Array(buffer),
        startConfirmationMime: input.mimeType || "image/png",
        invoicingFlagged: true,
        syncedToRf: sync.synced,
      },
    });
    revalidatePath(`/candidates/${placement.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to confirm start." };
  }
}

// ---- Cancel Placement ----
//
// Moves a Hired row out of the Hired bucket by flipping its Placement stage to
// "cancelled" and logging the reason. Kept as a Placement row so we don't lose
// fee/billing history for audit.

export type CancellationReason =
  | "candidate_resigned"
  | "client_terminated"
  | "failed_background_check"
  | "other";

export type CancelPlacementInput = {
  placementId: string;
  reason: CancellationReason;
  detail: string;
};

const VALID_CANCEL_REASON: ReadonlySet<CancellationReason> = new Set<CancellationReason>([
  "candidate_resigned",
  "client_terminated",
  "failed_background_check",
  "other",
]);

export async function cancelPlacement(input: CancelPlacementInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!VALID_CANCEL_REASON.has(input.reason)) return { ok: false, error: "Invalid cancellation reason." };

  try {
    const existing = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: { candidateRfId: true, jobRfId: true, clientRfId: true },
    });
    if (!existing) return { ok: false, error: "Placement not found." };

    await prisma.placement.update({
      where: { id: input.placementId },
      data: {
        stage: "cancelled",
        invoicingFlagged: false,
        syncedToRf: false,
      },
    });

    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "cancel_placement",
        subjectType: "candidate",
        subjectId: String(existing.candidateRfId),
        metadata: {
          placementId: input.placementId,
          jobRfId: existing.jobRfId,
          clientRfId: existing.clientRfId,
          reason: input.reason,
          detail: input.detail || null,
        },
      },
    });

    revalidatePath(`/candidates/${existing.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to cancel placement." };
  }
}

export async function deletePlacement(placementId: string): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const p = await prisma.placement.findUnique({ where: { id: placementId }, select: { candidateRfId: true } });
    if (!p) return { ok: false, error: "Not found." };
    await prisma.placement.delete({ where: { id: placementId } });
    revalidatePath(`/candidates/${p.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// ---- Reject / Unreject / Schedule Interview ----
//
// These write to ActionLog only. RF /external has no stage-change endpoint,
// so "sync" is manual — recruiter moves the candidate in RF themselves.
// We persist the intent here so the activity log shows who did what, when.

export type RejectCandidateInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  previousStage: string | null;
  reason: string;
};

export async function rejectCandidateJob(input: RejectCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "reject",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          previousStage: input.previousStage,
          reason: input.reason || null,
        },
      },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reject candidate." };
  }
}

export type UnrejectCandidateInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  targetStage: string; // previous stage or "submitted" fallback
};

export async function unrejectCandidateJob(input: UnrejectCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "unreject",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          targetStage: input.targetStage,
        },
      },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to unreject candidate." };
  }
}

// ---- Submit to Job ----

export type SubmitToJobInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  clientName: string;
};

export async function submitCandidateToJob(input: SubmitToJobInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  let rfSynced = false;
  let rfError: string | null = null;

  // Try to actually assign the candidate to the job in RecruiterFlow. We fetch
  // the candidate, append the new job_id to the existing jobs array with a
  // Client Submission stage, and push the merged list through /candidate/update.
  // RF may replace vs merge — we send the full array so either behavior works.
  try {
    const existing = await recruiterflow.getCandidate(input.candidateRfId);
    const existingJobs = Array.isArray(existing.jobs) ? existing.jobs : [];
    const alreadyLinked = existingJobs.some((j) => j?.job_id === input.jobRfId);
    if (!alreadyLinked) {
      const nextJobs: Array<{ job_id: number; stage_name?: string }> = [];
      for (const j of existingJobs) {
        if (typeof j?.job_id !== "number") continue;
        const entry: { job_id: number; stage_name?: string } = { job_id: j.job_id };
        if (j.stage_name) entry.stage_name = j.stage_name;
        nextJobs.push(entry);
      }
      nextJobs.push({ job_id: input.jobRfId, stage_name: "Client Submission" });

      const resp = (await recruiterflow.updateCandidate({
        id: input.candidateRfId,
        jobs: nextJobs,
      })) as { RESULT?: string };
      if (resp && typeof resp === "object" && "RESULT" in resp && resp.RESULT && resp.RESULT !== "SUCCESS") {
        rfError = `RecruiterFlow returned ${resp.RESULT}`;
      } else {
        rfSynced = true;
      }
    } else {
      // Already on the candidate in RF — treat as synced.
      rfSynced = true;
    }
  } catch (e) {
    rfError = e instanceof Error ? e.message : "Unknown RF error";
  }

  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "submit",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          jobTitle: input.jobTitle,
          clientName: input.clientName,
          targetStage: "submitted",
          rfSynced,
          rfError,
        },
      },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    if (!rfSynced && rfError) {
      return { ok: false, error: `Submittal logged, but RF sync failed: ${rfError}. Add the candidate in RecruiterFlow.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to submit candidate." };
  }
}

export type ScheduleInterviewInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  scheduledAt: string; // ISO datetime
  interviewerName: string;
  interviewerEmail: string;
  notes: string;
};

export async function scheduleInterview(input: ScheduleInterviewInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.scheduledAt) return { ok: false, error: "Interview date/time is required." };
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date/time." };
  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "schedule_interview",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          scheduledAt: when.toISOString(),
          interviewerName: input.interviewerName || null,
          interviewerEmail: input.interviewerEmail || null,
          notes: input.notes || null,
        },
      },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to schedule interview." };
  }
}

// ---- Submittal email flow ----
//
// generateSubmittalEmailBody: Claude-written writeup using candidate + job
// data, with the trailing "Let me know if you'd like to set up an interview"
// closer appended here (not in the Claude prompt) so it's always present.
//
// sendSubmittalEmail: actually sends the email via Gmail AND records an
// ActionLog "submit" row so the activity log picks it up.
//
// createCandidateConfirmationDraft: after submittal send, builds a draft in
// the recruiter's Gmail Drafts folder addressed to the candidate, using the
// "Great News" format. Not auto-sent.

export async function generateSubmittalEmailBody(args: {
  candidateRfId: number;
  jobTitle: string;
  clientName: string;
}): Promise<Result<{ body: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const c = await recruiterflow.getCandidate(args.candidateRfId);
    const firstName = c.first_name ?? (c.name ?? "").split(/\s+/)[0] ?? "";
    const lastName = c.last_name ?? (c.name ?? "").split(/\s+/).slice(1).join(" ") ?? "";
    const expectedSalary = (c.expected_salary ?? null) as
      | { number?: number | null; currency?: string | null }
      | null;
    const salaryStr = expectedSalary?.number
      ? `${expectedSalary.currency ?? "USD"} ${expectedSalary.number.toLocaleString()}`
      : "";
    const experienceSummary = summarizeExperience(c.experience);
    const notes = summarizeNotes(c.notes);
    const locationLabel =
      c.location?.location ?? [c.location?.city, c.location?.state].filter(Boolean).join(", ") ?? "";

    const input: SubmittalInput = {
      candidate: {
        firstName,
        lastName,
        title: c.current_designation ?? "",
        employer: c.current_organization ?? "",
        location: locationLabel,
        skills: Array.isArray(c.skills)
          ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
        experienceSummary,
        notes,
        expectedSalary: salaryStr,
        linkedin: c.linkedin_profile ?? "",
      },
      job: {
        title: args.jobTitle,
        clientName: args.clientName,
      },
    };

    const writeup = await generateSubmittalWriteup(input);
    const body = `${writeup.trim()}\n\nLet me know if you'd like to set up an interview with him/her.`;
    return { ok: true, value: { body } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to generate submittal body." };
  }
}

function summarizeExperience(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 4)
    .map((e) => {
      const r = e as { designation?: string; organization?: string; from?: [number | null, number | null]; to?: [number | null, number | null] };
      const span = [r.from?.[1], r.to?.[1]].filter(Boolean).join("–");
      return [r.designation, r.organization, span].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeNotes(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 3)
    .map((n) => (n as { note?: string }).note ?? "")
    .filter(Boolean)
    .join("\n");
}

export type SendSubmittalInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  clientName: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
};

export type SubmittalSendResult = {
  messageId: string;
  threadId: string;
};

export async function sendSubmittalEmail(input: SendSubmittalInput): Promise<Result<SubmittalSendResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  if (input.to.length === 0) return { ok: false, error: "At least one recipient (To) required." };
  if (!input.subject.trim()) return { ok: false, error: "Subject required." };
  if (!input.body.trim()) return { ok: false, error: "Body required." };

  const session = await getServerSession(authOptions);
  const fromEmail = session?.user?.email ?? "";
  const fromName = session?.user?.name ?? undefined;

  try {
    const sent = await sendGmail({
      userId,
      from: fromEmail,
      fromName,
      to: input.to,
      cc: input.cc,
      subject: input.subject.trim(),
      bodyText: input.body,
      bodyHtml: plainToHtml(input.body),
    });

    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "submit",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          jobTitle: input.jobTitle,
          clientName: input.clientName,
          targetStage: "submitted",
          emailSent: true,
          gmailMessageId: sent.id,
          gmailThreadId: sent.threadId,
          to: input.to,
          cc: input.cc,
          subject: input.subject,
        },
      },
    });

    // Best-effort RF push: append the job_id to the candidate's jobs[] with
    // a Client Submission stage. Swallow errors — the email has already gone
    // out and the ActionLog captures the intent.
    try {
      const rf = await recruiterflow.getCandidate(input.candidateRfId);
      const existingJobs = Array.isArray(rf.jobs) ? rf.jobs : [];
      const alreadyLinked = existingJobs.some((j) => j?.job_id === input.jobRfId);
      if (!alreadyLinked) {
        const nextJobs: Array<{ job_id: number; stage_name?: string }> = [];
        for (const j of existingJobs) {
          if (typeof j?.job_id !== "number") continue;
          const entry: { job_id: number; stage_name?: string } = { job_id: j.job_id };
          if (j.stage_name) entry.stage_name = j.stage_name;
          nextJobs.push(entry);
        }
        nextJobs.push({ job_id: input.jobRfId, stage_name: "Client Submission" });
        await recruiterflow.updateCandidate({ id: input.candidateRfId, jobs: nextJobs });
      }
    } catch {
      // ignored — RF sync failure doesn't undo a sent email
    }

    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true, value: { messageId: sent.id, threadId: sent.threadId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send submittal email." };
  }
}

export type CreateCandidateConfirmDraftInput = {
  candidateRfId: number;
  candidateEmail: string;
  candidateFirstName: string;
  clientName: string;
};

export async function createCandidateConfirmationDraft(
  input: CreateCandidateConfirmDraftInput,
): Promise<Result<{ draftId: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.candidateEmail) return { ok: false, error: "Candidate email not on file." };

  const session = await getServerSession(authOptions);
  const fromEmail = session?.user?.email ?? "";
  const fromName = session?.user?.name ?? undefined;

  const greeting = input.candidateFirstName ? `Hi ${input.candidateFirstName},` : "Hi,";
  const body =
    `${greeting}\n\n` +
    `Great news — you've been submitted to ${input.clientName || "the client"}.\n\n` +
    `Please reply "Understood!" so I know you're tracking.\n\n` +
    `A few ground rules while we're working this together:\n` +
    `• Please don't apply directly to the company or reach out to them.\n` +
    `• Let me know right away if you've applied or interviewed there before.\n` +
    `• I'll be your single point of contact until an interview is scheduled.\n\n` +
    `I'll circle back as soon as I have feedback from the client.\n\n` +
    `Thanks,\n`;

  try {
    const draft = await createGmailDraft({
      userId,
      from: fromEmail,
      fromName,
      to: [input.candidateEmail],
      subject: "Great News - You've Been Submitted!",
      bodyText: body,
      bodyHtml: plainToHtml(body),
    });
    return { ok: true, value: { draftId: draft.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create candidate draft." };
  }
}
