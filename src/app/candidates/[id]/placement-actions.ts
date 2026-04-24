"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { createActionLog } from "@/lib/action-log";
import { logActivity } from "@/lib/activity";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { generateSubmittalWriteup, type SubmittalInput } from "@/lib/claude";
import { createGmailDraft, plainToHtml, sendGmail, type GmailAttachment } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";
import { getRfCandidatesForOrg, getRfCandidateByRfId } from "@/lib/candidates";
import {
  submittalEditorHtmlToPlainText,
  submittalToHtml,
  submittalToPlainText,
  wrapEditorHtmlForGmail,
} from "@/lib/submittal-format";
import { applyMergeFields } from "@/lib/merge-fields";
import { buildFullMergeValues } from "@/lib/merge-context";
import { getAppPreferences } from "@/lib/preferences";
import { fireTemplatedEmail, type FireResult } from "@/lib/templated-email";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { formatLocation } from "@/lib/utils";
import { formatCompensation, type RFJob } from "@/lib/recruiterflow";
import {
  CANDIDATE_CONFIRMATION_TRIGGER,
  CANDIDATE_REJECTION_TRIGGER,
  INTERVIEW_CONFIRMATION_TRIGGER,
  OFFER_ACCEPTANCE_TRIGGER,
  REFERENCE_CHECK_REQUEST_TRIGGER,
} from "@/app/settings/template-constants";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  // The NextAuth JWT callback stamps user.id onto the session (see
  // src/lib/auth.ts jwt + session callbacks, and src/types/next-auth.d.ts),
  // so we read it directly instead of round-tripping through the DB on every
  // server-action call. That lookup was adding ~20–100 ms to every stage
  // move (keepCandidate, moveToKept, applyCandidateToJob, etc.) purely to
  // resolve a value the session already carries. Fallback to the email
  // lookup only if id is missing — shouldn't happen after a fresh sign-in,
  // but guarantees we don't break anyone holding an older JWT.
  const s = await getServerSession(authOptions);
  const email = s?.user?.email;
  if (!email) return null;
  if (s.user.id) return s.user.id;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
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

// Phase 4b: every Placement create/upsert now stamps the cuid FKs
// (jobId, clientId) alongside the legacy numeric RF ids. Callers that
// already know the cuid (e.g. Ace-native Jobs in the dropdown — the
// shim carries _aceJobId) can pass jobCuid/clientCuid directly.
// Otherwise we resolve by looking up Job/Client where legacyRfId
// matches the caller's numeric id (must be positive — synthetic
// negative ids from the shim never match a real legacyRfId).
async function resolveCuidFks(args: {
  jobRfId: number | null | undefined;
  jobCuid?: string | null;
  clientRfId: number | null | undefined;
  clientCuid?: string | null;
  organizationId: string;
}): Promise<{ jobId: string | null; clientId: string | null }> {
  let jobId: string | null = args.jobCuid ?? null;
  if (!jobId && args.jobRfId != null && args.jobRfId > 0) {
    const row = await prisma.job.findFirst({
      where: { legacyRfId: args.jobRfId, organizationId: args.organizationId },
      select: { id: true },
    });
    jobId = row?.id ?? null;
  }
  let clientId: string | null = args.clientCuid ?? null;
  if (!clientId && args.clientRfId != null && args.clientRfId > 0) {
    const row = await prisma.client.findFirst({
      where: { legacyRfId: args.clientRfId, organizationId: args.organizationId },
      select: { id: true },
    });
    clientId = row?.id ?? null;
  }
  return { jobId, clientId };
}

// ---- Offer Received ----

export type RecordOfferInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobCuid?: string | null;
  clientCuid?: string | null;
  salary: number | null;
  currency: string;
  title: string;
  startDate: string | null; // ISO date
  notes: string;
};

export async function recordOffer(input: RecordOfferInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const startDate = input.startDate ? new Date(input.startDate) : null;

  const sync = await trySyncRfStage({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    aceStage: "offer",
  });

  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });

  try {
    const row = await prisma.placement.upsert({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        jobId,
        clientRfId: input.clientRfId,
        clientId,
        stage: "offer",
        offerReceivedAt: new Date(),
        offerSalary: input.salary ?? null,
        offerCurrency: input.currency || "USD",
        offerTitle: input.title || null,
        offerStartDate: startDate,
        offerNotes: input.notes || null,
        syncedToRf: sync.synced,
        createdById: userId,
        organizationId: org.id,
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

    // Phase 4d: ActivityLog audit-feed entry for the recorded offer.
    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "offer_extended",
      targetType: "placement",
      targetId: row.id,
      metadata: {
        offerAmount: input.salary ?? null,
        currency: input.currency || "USD",
        title: input.title || null,
        startDate: input.startDate ?? null,
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
      },
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
  jobCuid?: string | null;
  clientCuid?: string | null;
  acceptedSalary: number;
  acceptedCurrency: string;
  feePercentage: number;
  feeTotal: number;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  // Primary (single) billing contact — kept as an explicit input for back-
  // compat with any caller that only knows about one. Newer callers send
  // billingContacts (below); when that's populated we derive these from
  // the first entry so legacy readers (Pipeline table, exports) stay happy.
  billingContactName: string;
  billingContactEmail: string;
  // Multi-contact billing list. Optional; when provided this wins — the
  // first entry is mirrored into billingContactName/Email and the full list
  // is stored in the Placement.billingContacts JSON column.
  billingContacts?: Array<{ name: string; email: string }>;
  hiringManagerName: string;
  hiringManagerEmail: string;
  expectedStartDate: string; // ISO
  notes: string;
};

export async function recordPlacement(input: RecordPlacementInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.expectedStartDate) return { ok: false, error: "Expected start date is required." };
  const org = await getCurrentOrg();

  const sync = await trySyncRfStage({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    aceStage: "pending_start",
  });

  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });

  try {
    // We branch by-hand instead of using upsert because `placedAt` has
    // conditional semantics: stamp it when we're entering Pending Start for
    // the first time (no prior placedAt), but leave it alone when the caller
    // is editing an already-placed row. Prisma's upsert.update can't express
    // "set X only if currently null" in a single statement.
    const existing = await prisma.placement.findUnique({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      select: { id: true, placedAt: true },
    });
    // Normalize the multi-contact list: drop entirely empty rows, trim, and
    // store undefined when the array is empty so the JSON column stays null
    // for placements that never filled it in (keeps legacy single-contact
    // reads working unchanged).
    const cleanedContacts = (input.billingContacts ?? [])
      .map((c) => ({ name: (c.name ?? "").trim(), email: (c.email ?? "").trim() }))
      .filter((c) => c.name || c.email);
    const primaryContact = cleanedContacts[0] ?? null;
    // When the caller sent a multi-contact list, the first entry wins over
    // the legacy single-contact fields — otherwise the UI-level "Add
    // Contact" flow would fight the single fields for the mirrored slot.
    const mirroredName = primaryContact?.name || input.billingContactName || null;
    const mirroredEmail = primaryContact?.email || input.billingContactEmail || null;
    const commonData = {
      acceptedSalary: input.acceptedSalary,
      acceptedCurrency: input.acceptedCurrency || "USD",
      feePercentage: input.feePercentage,
      feeTotal: input.feeTotal,
      minFee: input.minFee,
      guaranteePeriodDays: input.guaranteePeriodDays,
      billingContactName: mirroredName,
      billingContactEmail: mirroredEmail,
      billingContacts: cleanedContacts.length > 0 ? cleanedContacts : Prisma.JsonNull,
      hiringManagerName: input.hiringManagerName || null,
      hiringManagerEmail: input.hiringManagerEmail || null,
      expectedStartDate: new Date(input.expectedStartDate),
      placementNotes: input.notes || null,
      syncedToRf: sync.synced,
    };
    let row: { id: string; syncedToRf: boolean };
    if (!existing) {
      row = await prisma.placement.create({
        data: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
          jobId,
          clientRfId: input.clientRfId,
          clientId,
          stage: "pending_start",
          placedAt: new Date(),
          createdById: userId,
          organizationId: org.id,
          ...commonData,
        },
        select: { id: true, syncedToRf: true },
      });
    } else {
      row = await prisma.placement.update({
        where: { id: existing.id },
        data: {
          stage: "pending_start",
          // First transition to Pending Start → stamp placedAt. Edits to an
          // already-placed row keep the original timestamp so the dashboard
          // "Placements Made" counter never double-counts the same deal.
          ...(existing.placedAt ? {} : { placedAt: new Date() }),
          ...commonData,
        },
        select: { id: true, syncedToRf: true },
      });
    }
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    revalidatePath(`/dashboard`);
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
  const org = await getCurrentOrg();

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
      select: {
        jobRfId: true,
        candidateRfId: true,
        feeTotal: true,
        acceptedSalary: true,
        feePercentage: true,
        expectedStartDate: true,
      },
    });
    const sync = existing && existing.candidateRfId != null && existing.jobRfId != null
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

    // Phase 4c: audit-feed entry for the confirmed placement. Non-
    // throwing; instrumentation never blocks the user action.
    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "placement_confirmed",
      targetType: "placement",
      targetId: input.placementId,
      metadata: {
        feeAmount: existing?.feeTotal ?? null,
        acceptedSalary: existing?.acceptedSalary ?? null,
        feePercentage: existing?.feePercentage ?? null,
        startDate: existing?.expectedStartDate?.toISOString() ?? null,
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

    await createActionLog({
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

// ---- Cancelled-row transitions ----
//
// Once a placement is cancelled the row becomes a permanent record on the
// candidate profile. These actions let the user pick where the candidate
// goes next for that job:
//   - reapplyCancelledPlacement  → delete the cancelled Placement row. The
//     row reverts to RF's stage_name (typically "Client Submission" =
//     Submitted bucket).
//   - moveCancelledToAceStage    → replace the cancelled row with an
//     Ace-local stage override (sourced or applied). Stored as Placement.stage.
//   - removeCandidateFromJob     → delete the Placement row AND attempt to
//     strip the job from RF's candidate.jobs[] via /candidate/update.

export type ReapplyInput = { placementId: string };

export async function reapplyCancelledPlacement(input: ReapplyInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const p = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: { id: true, candidateRfId: true, jobRfId: true, clientRfId: true, stage: true },
    });
    if (!p) return { ok: false, error: "Placement not found." };
    if (p.stage !== "cancelled") return { ok: false, error: "Not a cancelled placement." };

    await prisma.placement.delete({ where: { id: input.placementId } });
    await createActionLog({
      userId,
      actionType: "reapply_cancelled_placement",
      subjectType: "candidate",
      subjectId: String(p.candidateRfId),
      metadata: { jobRfId: p.jobRfId, clientRfId: p.clientRfId, placementId: input.placementId, target: "submitted" },
    });
    revalidatePath(`/candidates/${p.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reapply failed." };
  }
}

export type MoveCancelledInput = {
  placementId: string;
  target: "sourced" | "applied";
};

export async function moveCancelledToAceStage(input: MoveCancelledInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (input.target !== "sourced" && input.target !== "applied") {
    return { ok: false, error: "Invalid target stage." };
  }
  try {
    const p = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: { id: true, candidateRfId: true, jobRfId: true, clientRfId: true, stage: true },
    });
    if (!p) return { ok: false, error: "Placement not found." };
    if (p.stage !== "cancelled") return { ok: false, error: "Not a cancelled placement." };

    await prisma.placement.update({
      where: { id: input.placementId },
      data: { stage: input.target, syncedToRf: false, invoicingFlagged: false },
    });
    await createActionLog({
      userId,
      actionType: "move_cancelled_placement",
      subjectType: "candidate",
      subjectId: String(p.candidateRfId),
      metadata: { jobRfId: p.jobRfId, clientRfId: p.clientRfId, placementId: input.placementId, target: input.target },
    });
    revalidatePath(`/candidates/${p.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Move failed." };
  }
}

export type RemoveFromJobInput = { placementId: string };

export async function removeCancelledFromJob(input: RemoveFromJobInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const p = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: { id: true, candidateRfId: true, jobRfId: true, clientRfId: true, stage: true },
    });
    if (!p) return { ok: false, error: "Placement not found." };

    await prisma.placement.delete({ where: { id: input.placementId } });

    // Best-effort RF cleanup — remove the job from the candidate's jobs[].
    // Skip entirely for Ace-local candidates (no RF id to reach).
    let rfSynced = false;
    let rfError: string | null = null;
    if (p.candidateRfId != null) {
      const candidateRfId = p.candidateRfId;
      try {
        const rf = await getRfCandidateByRfId(candidateRfId);
        const existing = Array.isArray(rf?.jobs) ? rf.jobs : [];
        const filtered: Array<{ job_id: number; stage_name?: string }> = [];
        for (const j of existing) {
          if (typeof j?.job_id !== "number") continue;
          if (j.job_id === p.jobRfId) continue;
          const entry: { job_id: number; stage_name?: string } = { job_id: j.job_id };
          if (j.stage_name) entry.stage_name = j.stage_name;
          filtered.push(entry);
        }
        const resp = (await recruiterflow.updateCandidate({ id: candidateRfId, jobs: filtered })) as { RESULT?: string };
        if (resp && typeof resp === "object" && "RESULT" in resp && resp.RESULT && resp.RESULT !== "SUCCESS") {
          rfError = `RecruiterFlow returned ${resp.RESULT}`;
        } else {
          rfSynced = true;
        }
      } catch (e) {
        rfError = e instanceof Error ? e.message : "Unknown RF error";
      }
    }

    await createActionLog({
      userId,
      actionType: "remove_cancelled_from_job",
      subjectType: "candidate",
      subjectId: String(p.candidateRfId),
      metadata: {
        jobRfId: p.jobRfId,
        clientRfId: p.clientRfId,
        placementId: input.placementId,
        rfSynced,
        rfError,
      },
    });
    revalidatePath(`/candidates/${p.candidateRfId}`);
    revalidatePath(`/pipeline`);
    // Ace is source of truth — if RF refused the jobs[] edit, that's captured
    // in ActionLog metadata (rfSynced/rfError). We return success either way.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
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
  jobCuid?: string | null;
  clientCuid?: string | null;
  previousStage: string | null;
  reason: string;
};

export async function rejectCandidateJob(input: RejectCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });
  try {
    // Upsert an Ace-local Placement row so the candidate profile shows
    // DISQUALIFIED · <date> regardless of what RF's stage_name is. The
    // updatedAt timestamp is what renders as the disqualification date.
    await prisma.placement.upsert({
      where: {
        candidateRfId_jobRfId: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
        },
      },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        jobId,
        clientRfId: input.clientRfId,
        clientId,
        stage: "rejected",
        createdById: userId,
        organizationId: org.id,
        syncedToRf: false,
      },
      update: {
        stage: "rejected",
        syncedToRf: false,
        invoicingFlagged: false,
      },
    });

    await createActionLog({
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
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    revalidatePath(`/jobs/${input.jobRfId}`);
    revalidatePath(`/applicants`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reject candidate." };
  }
}

export type UnrejectCandidateInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobCuid?: string | null;
  clientCuid?: string | null;
  targetStage: string; // previous stage or "submitted" fallback
};

export async function unrejectCandidateJob(input: UnrejectCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });
  try {
    // Actually flip the Placement back — until now this only logged
    // intent, which meant the local-stage overlay on /jobs/[id]
    // (and the candidate profile) kept showing "rejected" forever
    // because the row was never updated. Default to the caller's
    // targetStage when it's a known bucket; otherwise fall back to
    // "submitted" per the existing UnrejectDialog default.
    const allowed = new Set(["sourced", "applied", "submitted", "interviewing", "offer", "pending_start"]);
    const nextStage = allowed.has(input.targetStage) ? input.targetStage : "submitted";
    await prisma.placement.upsert({
      where: {
        candidateRfId_jobRfId: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
        },
      },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        jobId,
        clientRfId: input.clientRfId,
        clientId,
        stage: nextStage,
        createdById: userId,
        organizationId: org.id,
        syncedToRf: false,
      },
      update: {
        stage: nextStage,
        syncedToRf: false,
      },
    });
    await createActionLog({
      userId,
      actionType: "unreject",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        targetStage: nextStage,
      },
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    revalidatePath(`/jobs/${input.jobRfId}`);
    revalidatePath(`/applicants`);
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
  jobCuid?: string | null;
  clientCuid?: string | null;
  jobTitle: string;
  clientName: string;
};

export async function submitCandidateToJob(input: SubmitToJobInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });

  let rfSynced = false;
  let rfError: string | null = null;

  // Try to actually assign the candidate to the job in RecruiterFlow. We fetch
  // the candidate, append the new job_id to the existing jobs array with a
  // Client Submission stage, and push the merged list through /candidate/update.
  // RF may replace vs merge — we send the full array so either behavior works.
  try {
    const existing = await getRfCandidateByRfId(input.candidateRfId);
    const existingJobs = Array.isArray(existing?.jobs) ? existing.jobs : [];
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
    // Upsert a local Placement at stage="submitted". Mirrors the
    // applyCandidateToJob pattern: Ace is source of truth, RF sync
    // above is best-effort. Without this, the Job-detail Pipeline
    // section's local-stage overlay (jobs/[id]/page.tsx) wouldn't
    // see the move and the row would stay under Sourced for the
    // 60s the RF data-cache TTL still serves the old stage_name.
    await prisma.placement.upsert({
      where: {
        candidateRfId_jobRfId: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
        },
      },
      create: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        jobId,
        clientRfId: input.clientRfId,
        clientId,
        stage: "submitted",
        createdById: userId,
        organizationId: org.id,
        syncedToRf: rfSynced,
      },
      update: {
        stage: "submitted",
        syncedToRf: rfSynced,
      },
    });

    await createActionLog({
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
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    revalidatePath(`/jobs/${input.jobRfId}`);
    revalidatePath(`/applicants`);
    // Ace is source of truth — RF sync is best-effort. Never block the caller
    // on RF errors; they're captured in the ActionLog metadata for audit.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to submit candidate." };
  }
}

// ---- Generate submittal writeup ----
//
// Same shape as summarizeAgreement / summarizeBenefitsWithAI in
// clients/[id]/actions.ts: server action, calls the claude helper, returns
// { ok, value: { text } } | { ok:false, error }. No fetch, no route handler,
// no content-type handling on the client. Client calls this via RPC the same
// way the summary buttons on the clients page do.

export type GenerateSubmittalInput = {
  candidateRfId: number;
  jobRfId?: number;
  jobTitle: string;
  clientName: string;
  // First name of the primary client contact being written to. Lets Claude
  // seed "Hi [ClientFirstName]," at the top of the generated submittal so the
  // recruiter doesn't hand-edit the greeting for every send.
  clientContactFirstName?: string;
};

export type GenerateSubmittalResult = Result<{ text: string }>;

export async function generateSubmittal(input: GenerateSubmittalInput): Promise<GenerateSubmittalResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!Number.isFinite(input.candidateRfId)) {
    return { ok: false, error: "candidateRfId is required." };
  }

  try {
    // RF /candidate/{id} returns 404 on the external API (the whole reason the
    // rest of the app reads /candidate/list and filters). We mirror that here
    // so the generator works like every other candidate read-path in Ace.
    const candidates = await getRfCandidatesForOrg();
    const c = candidates.find((x) => x.id === input.candidateRfId);
    if (!c) return { ok: false, error: "Candidate not found in RecruiterFlow." };
    const { firstName, lastName } = extractCandidateFields(c);

    const expectedSalary = (c.expected_salary ?? null) as
      | { number?: number | null; currency?: string | null }
      | null;
    const salaryStr = expectedSalary?.number
      ? `${expectedSalary.currency ?? "USD"} ${expectedSalary.number.toLocaleString()}`
      : "";

    const experienceSummary = summarizeExperienceForSubmittal(c.experience);
    const notes = summarizeNotesForSubmittal(c.notes);
    const locationLabel = formatLocation(c.location);

    // Pull the full RFJob so Claude sees role context (location, comp range,
    // employment type, department, description, custom fields). /job/{id} 404s
    // on the external API the same way /candidate/{id} does, so we list + find.
    let jobCtx: SubmittalInput["job"] = {
      title: input.jobTitle,
      clientName: input.clientName,
    };
    if (Number.isFinite(input.jobRfId)) {
      try {
        // Phase 2: jobs list comes from Neon via the broadened shim so
        // writeup generation still works even when RF is unreachable.
        const { getRfJobsForOrg } = await import("@/lib/candidates");
        const jobs = await getRfJobsForOrg();
        const j = jobs.find((x) => x.id === input.jobRfId);
        if (j) jobCtx = buildSubmittalJobContext(j, input.jobTitle, input.clientName);
      } catch {
        // Non-fatal — fall through with the minimal title/client context.
      }
    }

    const payload: SubmittalInput = {
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
      job: jobCtx,
      clientContactFirstName: input.clientContactFirstName,
    };

    // Claude now produces the full email body including the greeting and
    // the closing "Let me know if you'd like to set up an interview…" line,
    // so we return it verbatim — no more tail append.
    const text = (await generateSubmittalWriteup(payload)).trim();
    return { ok: true, value: { text } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claude generation failed" };
  }
}

function buildSubmittalJobContext(j: RFJob, fallbackTitle: string, fallbackClient: string): SubmittalInput["job"] {
  const raw = j as unknown as { description?: unknown; job_description?: unknown };
  const descriptionStr =
    typeof raw.description === "string"
      ? raw.description
      : typeof raw.job_description === "string"
        ? raw.job_description
        : "";

  const customFields = Array.isArray(j.custom_fields)
    ? j.custom_fields
        .map((cf) => ({
          name: (cf?.name ?? "").toString(),
          value: typeof cf?.value === "string" ? cf.value : cf?.value == null ? "" : JSON.stringify(cf.value),
        }))
        .filter((cf) => cf.name && cf.value)
    : [];

  return {
    title: j.title ?? j.name ?? fallbackTitle,
    clientName: j.company?.name ?? fallbackClient,
    locations: Array.isArray(j.locations) ? j.locations.filter((x): x is string => typeof x === "string") : [],
    salaryRange: formatCompensation(j),
    employmentType: j.employment_type ?? undefined,
    jobType: j.job_type?.name ?? undefined,
    department: j.department ?? undefined,
    description: descriptionStr.trim() || undefined,
    customFields,
  };
}

function summarizeExperienceForSubmittal(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 4)
    .map((e) => {
      const r = e as {
        designation?: string;
        organization?: string;
        from?: [number | null, number | null];
        to?: [number | null, number | null];
      };
      const span = [r.from?.[1], r.to?.[1]].filter(Boolean).join("–");
      return [r.designation, r.organization, span].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeNotesForSubmittal(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 3)
    .map((n) => (n as { note?: string }).note ?? "")
    .filter(Boolean)
    .join("\n");
}

// ---- Apply to Job (candidate-applied, not recruiter-submitted) ----
//
// Same shape as submitCandidateToJob but pushes RF stage_name "Applied" and
// logs actionType=apply. Useful when a candidate self-applies or is applied
// on their behalf without a full submittal email flow.
export async function applyCandidateToJob(input: SubmitToJobInput): Promise<Result<{ placementId: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });

  // Step 1: Local Placement row. This is the source of truth for the
  // profile's Jobs panel and the Pipeline — RF's c.jobs[] is advisory.
  // Reject if an earlier stage row already exists at submitted-or-later,
  // so we don't silently downgrade a candidate already in the pipeline.
  // Stamp source="recruiter_applied" on first write so the Applicants
  // table can render "Recruiter Applied" in the Source column. Don't
  // overwrite source on the update branch — that preserves whatever
  // earlier inbound source (job_board / careers_form / rf_import)
  // first landed the candidate.
  let placementId: string;
  try {
    const existing = await prisma.placement.findUnique({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      select: { id: true, stage: true, source: true },
    });
    if (existing) {
      if (existing.stage !== "applied" && existing.stage !== "sourced") {
        return {
          ok: false,
          error: `Candidate is already linked to this job at stage "${existing.stage}". Use the existing record instead.`,
        };
      }
      await prisma.placement.update({
        where: { id: existing.id },
        data: {
          stage: "applied",
          syncedToRf: false,
          // Backfill source on existing rows that pre-date the column
          // OR were created by a sourced-stage import without one. Once
          // a row has a real source we leave it alone.
          source: existing.source ?? "recruiter_applied",
        },
      });
      placementId = existing.id;
    } else {
      const created = await prisma.placement.create({
        data: {
          candidateRfId: input.candidateRfId,
          candidateId: null,
          jobRfId: input.jobRfId,
          jobId,
          clientRfId: input.clientRfId,
          clientId,
          stage: "applied",
          source: "recruiter_applied",
          createdById: userId,
          organizationId: org.id,
          syncedToRf: false,
        },
        select: { id: true },
      });
      placementId = created.id;
    }
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't save application to Ace: ${e instanceof Error ? e.message : "unknown DB error"}`,
    };
  }

  // Step 2: Best-effort RF sync. Failures don't undo the local write — the
  // profile reads from the Placement table and will show the job regardless.
  let rfSynced = false;
  let rfError: string | null = null;
  try {
    const existing = await getRfCandidateByRfId(input.candidateRfId);
    const existingJobs = Array.isArray(existing?.jobs) ? existing.jobs : [];
    const alreadyLinked = existingJobs.some((j) => j?.job_id === input.jobRfId);
    if (!alreadyLinked) {
      const nextJobs: Array<{ job_id: number; stage_name?: string }> = [];
      for (const j of existingJobs) {
        if (typeof j?.job_id !== "number") continue;
        const entry: { job_id: number; stage_name?: string } = { job_id: j.job_id };
        if (j.stage_name) entry.stage_name = j.stage_name;
        nextJobs.push(entry);
      }
      nextJobs.push({ job_id: input.jobRfId, stage_name: "Applied" });
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
      rfSynced = true;
    }
  } catch (e) {
    rfError = e instanceof Error ? e.message : "Unknown RF error";
  }

  try {
    await createActionLog({
      userId,
      actionType: "apply",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: {
        placementId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        jobTitle: input.jobTitle,
        clientName: input.clientName,
        targetStage: "applied",
        rfSynced,
        rfError,
      },
    });
  } catch {
    // ActionLog is observability, not load-bearing. Swallow.
  }

  // Phase 4d: audit-feed entry for candidate_applied_to_job. Non-
  // throwing. targetId is the Neon Candidate.id (cuid); we look it up
  // by rfId since applyCandidateToJob's input is still RF-keyed.
  const candidateRow = await prisma.candidate.findFirst({
    where: { rfId: input.candidateRfId, organizationId: org.id },
    select: { id: true },
  });
  if (candidateRow) {
    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "candidate_applied_to_job",
      targetType: "candidate",
      targetId: candidateRow.id,
      metadata: {
        placementId,
        jobId: jobId ?? null,
        jobRfId: input.jobRfId,
        clientId: clientId ?? null,
        clientRfId: input.clientRfId,
        jobTitle: input.jobTitle,
        clientName: input.clientName,
        rfSynced,
      },
    });
  }

  revalidatePath(`/candidates/${input.candidateRfId}`);
  revalidatePath(`/pipeline`);
  revalidatePath(`/jobs/${input.jobRfId}`);
  revalidatePath(`/applicants`);
  return { ok: true, value: { placementId } };
}

// scheduleInterview moved to src/app/candidates/[id]/interview-actions.ts
// It now writes a dedicated Interview row (+ calendar event) instead of just
// appending to ActionLog.

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
    const c = await getRfCandidateByRfId(args.candidateRfId);
    if (!c) return { ok: false, error: "Candidate not found in RecruiterFlow." };
    const { firstName, lastName } = extractCandidateFields(c);
    const expectedSalary = (c.expected_salary ?? null) as
      | { number?: number | null; currency?: string | null }
      | null;
    const salaryStr = expectedSalary?.number
      ? `${expectedSalary.currency ?? "USD"} ${expectedSalary.number.toLocaleString()}`
      : "";
    const experienceSummary = summarizeExperience(c.experience);
    const notes = summarizeNotes(c.notes);
    const locationLabel = formatLocation(c.location);

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

    // Claude now emits the full body including greeting + closing line.
    const body = (await generateSubmittalWriteup(input)).trim();
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

export type SubmittalResumeVariant = "original" | "branded";

export type SubmittalResumeOption = {
  variant: SubmittalResumeVariant;
  label: string;
  filename: string;
  size: number;
  uploadedAt: string; // ISO
  mimeType: string;
};

export type ListSubmittalResumeOptionsResult =
  | { ok: true; value: SubmittalResumeOption[] }
  | { ok: false; error: string };

// Returns the resume variants the recruiter can pick from for a submittal.
// One row per candidateRfId in CandidateResume; the redacted ("branded")
// variant is included only when redactedData is populated. The recruiter
// always sees the original first, branded second.
export async function listSubmittalResumeOptions(
  candidateRfId: number,
): Promise<ListSubmittalResumeOptionsResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const row = await prisma.candidateResume.findUnique({
    where: { candidateRfId },
    select: {
      filename: true,
      mimeType: true,
      size: true,
      uploadedAt: true,
      uploadComplete: true,
      redactedSize: true,
      redactedMimeType: true,
      redactedAt: true,
    },
  });
  if (!row || !row.uploadComplete) return { ok: true, value: [] };
  const options: SubmittalResumeOption[] = [
    {
      variant: "original",
      label: "Original",
      filename: row.filename,
      size: row.size,
      uploadedAt: row.uploadedAt.toISOString(),
      mimeType: row.mimeType,
    },
  ];
  if (row.redactedAt) {
    const brandedFilename = row.filename.replace(/\.pdf$/i, "") + "-BreakPoint.pdf";
    options.push({
      variant: "branded",
      label: "BreakPoint Branded",
      filename: brandedFilename,
      size: row.redactedSize ?? row.size,
      uploadedAt: row.redactedAt.toISOString(),
      mimeType: row.redactedMimeType ?? "application/pdf",
    });
  }
  return { ok: true, value: options };
}

async function loadSubmittalAttachment(
  candidateRfId: number,
  variant: SubmittalResumeVariant,
): Promise<{ ok: true; value: GmailAttachment } | { ok: false; error: string }> {
  const row = await prisma.candidateResume.findUnique({
    where: { candidateRfId },
  });
  if (!row || !row.uploadComplete) {
    return { ok: false, error: "No resume uploaded for this candidate." };
  }
  if (variant === "branded") {
    if (!row.redactedData || !row.redactedAt) {
      return { ok: false, error: "No branded resume available for this candidate." };
    }
    const bytes = row.redactedData;
    return {
      ok: true,
      value: {
        filename: row.filename.replace(/\.pdf$/i, "") + "-BreakPoint.pdf",
        mimeType: row.redactedMimeType ?? "application/pdf",
        data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      },
    };
  }
  const bytes = row.data;
  return {
    ok: true,
    value: {
      filename: row.filename,
      mimeType: row.mimeType,
      data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    },
  };
}

export type SendSubmittalInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobCuid?: string | null;
  clientCuid?: string | null;
  jobTitle: string;
  clientName: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  // When the composer is in rich-text (Tiptap) mode, the client sends HTML
  // directly. If present, we use it verbatim for the Gmail text/html
  // alternative and derive a stripped plain-text version for the text/plain
  // alternative. Falls back to the marker-flavored `body` when absent, which
  // is the legacy path for any caller still using the textarea composer.
  bodyHtml?: string;
  attachment?: { variant: SubmittalResumeVariant } | null;
};

export type SubmittalSendResult = {
  placementId: string;
  messageId: string;
  threadId: string;
};

// Stages that should NOT be downgraded back to "submitted" on a re-submit.
// Submitting again from a later pipeline stage just resends the email; we
// keep the row where it is.
const STAGES_AFTER_SUBMITTED = new Set([
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "cancelled",
  "rejected",
]);

export async function sendSubmittalEmail(input: SendSubmittalInput): Promise<Result<SubmittalSendResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });

  if (input.to.length === 0) return { ok: false, error: "At least one recipient (To) required." };
  if (!input.subject.trim()) return { ok: false, error: "Subject required." };
  if (!input.body.trim()) return { ok: false, error: "Body required." };

  // Step 1: Write the Placement row BEFORE sending the email. The Jobs panel
  // on the candidate profile and the Pipeline both read from this table; if
  // this write fails we must refuse to proceed, otherwise the recruiter
  // silently loses the record.
  let placementId: string;
  try {
    const existing = await prisma.placement.findUnique({
      where: { candidateRfId_jobRfId: { candidateRfId: input.candidateRfId, jobRfId: input.jobRfId } },
      select: { id: true, stage: true },
    });
    if (existing) {
      if (STAGES_AFTER_SUBMITTED.has(existing.stage)) {
        placementId = existing.id;
      } else {
        await prisma.placement.update({
          where: { id: existing.id },
          data: { stage: "submitted", syncedToRf: false },
        });
        placementId = existing.id;
      }
    } else {
      const created = await prisma.placement.create({
        data: {
          candidateRfId: input.candidateRfId,
          candidateId: null,
          jobRfId: input.jobRfId,
          jobId,
          clientRfId: input.clientRfId,
          clientId,
          stage: "submitted",
          createdById: userId,
          organizationId: org.id,
          syncedToRf: false,
        },
        select: { id: true },
      });
      placementId = created.id;
    }
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't save submittal to Ace (no email sent): ${e instanceof Error ? e.message : "unknown DB error"}`,
    };
  }

  const session = await getServerSession(authOptions);
  const fromEmail = session?.user?.email ?? "";
  const fromName = session?.user?.name ?? undefined;

  // Step 2: Send the email. If this fails, the Placement row is already
  // in place — the recruiter sees an error but the candidate appears on the
  // profile/pipeline so they can retry the send without re-picking the job.
  let attachments: GmailAttachment[] | undefined;
  if (input.attachment) {
    const att = await loadSubmittalAttachment(input.candidateRfId, input.attachment.variant);
    if (!att.ok) {
      return {
        ok: false,
        error: `Candidate linked in Ace, but resume attachment failed: ${att.error}. No email was sent.`,
      };
    }
    attachments = [att.value];
  }

  let sent: { id: string; threadId: string };
  try {
    const useRichHtml = typeof input.bodyHtml === "string" && input.bodyHtml.trim().length > 0;
    sent = await sendGmail({
      userId,
      from: fromEmail,
      fromName,
      to: input.to,
      cc: input.cc,
      subject: input.subject.trim(),
      // Rich path: the Tiptap editor already produced the <p>/<strong>/<u>
      // structure we want in Gmail, so skip the marker conversion. The plain
      // alternative is derived from the same HTML so line breaks / bullet
      // dashes survive in text-only mail clients.
      // Legacy path: marker-flavored body from the textarea composer runs
      // through the existing submittalTo*/submittalToHtml pair.
      bodyText: useRichHtml
        ? submittalEditorHtmlToPlainText(input.bodyHtml!)
        : submittalToPlainText(input.body),
      bodyHtml: useRichHtml
        ? wrapEditorHtmlForGmail(input.bodyHtml!)
        : submittalToHtml(input.body),
      attachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send submittal email.";
    // Log the failed attempt so it shows in the activity log.
    try {
      await createActionLog({
        userId,
        actionType: "submit",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          placementId,
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          jobTitle: input.jobTitle,
          clientName: input.clientName,
          targetStage: "submitted",
          emailSent: false,
          emailError: msg,
          to: input.to,
          cc: input.cc,
          subject: input.subject,
        },
      });
    } catch {
      // swallow: ActionLog is observability, not load-bearing
    }
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return {
      ok: false,
      error: `Candidate linked in Ace, but email failed: ${msg}. Retry the email from the activity log.`,
    };
  }

  try {
    await createActionLog({
      userId,
      actionType: "submit",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: {
        placementId,
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
        attachmentVariant: input.attachment?.variant ?? null,
        attachmentFilename: attachments?.[0]?.filename ?? null,
      },
    });
  } catch {
    // swallow: ActionLog is observability, not load-bearing
  }

  // Best-effort RF push: append the job_id to the candidate's jobs[] with
  // a Client Submission stage. Swallow errors — the email has gone out and
  // the Placement row carries the source of truth either way.
  try {
    const rf = await getRfCandidateByRfId(input.candidateRfId);
    const existingJobs = Array.isArray(rf?.jobs) ? rf.jobs : [];
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
    // ignored
  }

  // Phase 4c: audit-feed entry for the submittal. Non-throwing.
  // Stamps placementId as the target so the activity feed can link
  // back to the specific placement; jobId/candidateId/clientId live in
  // metadata for rollup filters.
  await logActivity({
    organizationId: org.id,
    userId,
    actionType: "submittal_sent",
    targetType: "placement",
    targetId: placementId,
    metadata: {
      jobId: jobId ?? null,
      jobRfId: input.jobRfId,
      candidateRfId: input.candidateRfId,
      clientId: clientId ?? null,
      clientRfId: input.clientRfId,
      jobTitle: input.jobTitle,
      clientName: input.clientName,
    },
  });

  revalidatePath(`/candidates/${input.candidateRfId}`);
  revalidatePath(`/pipeline`);
  return { ok: true, value: { placementId, messageId: sent.id, threadId: sent.threadId } };
}

export type DeliverCandidateConfirmationInput = {
  candidateRfId: number;
  candidateEmail: string;
  candidateFirstName: string;
  candidateLastName: string;
  jobRfId: number;
  clientRfId: number;
  clientCompanyName: string;
  clientContactFullName?: string;
  clientContactFirstName?: string;
  jobTitle: string;
  jobLocation?: string;
};

export type CandidateConfirmationResult = {
  mode: "sent" | "drafted";
  id: string;
  threadId: string;
};

// After a successful client submittal we kick off the candidate confirmation.
// Pulls the "candidate_submission_confirmation" template from the DB, resolves
// every merge-field token against candidate / job / recruiter values, then
// either sends (autoSendCandidateConfirmation = true) or drops a Gmail draft.
export async function deliverCandidateConfirmation(
  input: DeliverCandidateConfirmationInput,
): Promise<Result<CandidateConfirmationResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.candidateEmail) return { ok: false, error: "Candidate email not on file." };

  const session = await getServerSession(authOptions);
  const fromEmail = session?.user?.email ?? "";
  const fromName = session?.user?.name ?? undefined;

  const [template, prefs] = await Promise.all([
    prisma.emailTemplate.findFirst({
      where: { trigger: CANDIDATE_CONFIRMATION_TRIGGER, isActive: true },
      orderBy: { updatedAt: "desc" },
    }),
    getAppPreferences(),
  ]);

  if (!template) {
    return { ok: false, error: "Candidate confirmation template missing. Check Settings → Templates." };
  }

  // Resolve every merge field fresh from RF + preferences. Overrides keep
  // any authoritative strings the caller already computed (e.g. formatted
  // fields) without blanking when falsy.
  const values = await buildFullMergeValues({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    clientRfId: input.clientRfId,
    overrides: {
      clientCompanyName: input.clientCompanyName,
      clientContactFullName: input.clientContactFullName,
      clientContactFirstName: input.clientContactFirstName,
      jobTitle: input.jobTitle,
      jobLocation: input.jobLocation,
    },
  });

  const subject = applyMergeFields(template.subject, values);
  const body = applyMergeFields(template.body, values);
  const autoSend = prefs.autoSendCandidateConfirmation;

  try {
    if (autoSend) {
      const sent = await sendGmail({
        userId,
        from: fromEmail,
        fromName,
        to: [input.candidateEmail],
        subject,
        bodyText: body,
        bodyHtml: plainToHtml(body),
      });
      await createActionLog({
        userId,
        actionType: "candidate_confirmation_sent",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          to: input.candidateEmail,
          subject,
          gmailMessageId: sent.id,
          gmailThreadId: sent.threadId,
        },
      });
      return { ok: true, value: { mode: "sent", id: sent.id, threadId: sent.threadId } };
    }

    const draft = await createGmailDraft({
      userId,
      from: fromEmail,
      fromName,
      to: [input.candidateEmail],
      subject,
      bodyText: body,
      bodyHtml: plainToHtml(body),
    });
    await createActionLog({
      userId,
      actionType: "candidate_confirmation_drafted",
      subjectType: "candidate",
      subjectId: String(input.candidateRfId),
      metadata: {
        to: input.candidateEmail,
        subject,
        gmailDraftId: draft.id,
        gmailThreadId: draft.threadId,
      },
    });
    return { ok: true, value: { mode: "drafted", id: draft.id, threadId: draft.threadId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to deliver candidate confirmation." };
  }
}

// ---- Shared merge-field + template delivery plumbing for trigger-fired emails ----
//
// Each auto-triggered flow (reject, offer accepted, interview scheduled,
// reference check) calls fireTriggerForCandidateJob with a trigger key and
// overrides. We fetch the candidate once, build every known merge field, and
// hand off to fireTemplatedEmail. Callers pick the To/Cc recipients and any
// flow-specific overrides ([Offer Amount], [Start Date], [Job Description]).

type TriggerFireInput = {
  trigger: string;
  candidateRfId: number;
  jobRfId?: number;
  clientRfId?: number;
  jobTitle?: string;
  jobLocation?: string;
  jobDescription?: string;
  clientCompanyName?: string;
  clientContactFullName?: string;
  clientContactFirstName?: string;
  to: string[];
  cc?: string[];
  offerAmount?: string;
  startDate?: string;
  mode?: "send" | "draft";
};

type TriggerFireOutcome = {
  fire: FireResult;
  candidateEmail: string;
};

async function fireTriggerForCandidateJob(input: TriggerFireInput): Promise<TriggerFireOutcome> {
  const userId = await requireUserId();
  if (!userId) {
    return { fire: { status: "error", error: "Not signed in." }, candidateEmail: "" };
  }
  const session = await getServerSession(authOptions);
  const fromEmail = session?.user?.email ?? "";
  const fromName = session?.user?.name ?? null;

  const values = await buildFullMergeValues({
    candidateRfId: input.candidateRfId,
    jobRfId: input.jobRfId,
    clientRfId: input.clientRfId,
    overrides: {
      clientCompanyName: input.clientCompanyName,
      clientContactFullName: input.clientContactFullName,
      clientContactFirstName: input.clientContactFirstName,
      jobTitle: input.jobTitle,
      jobLocation: input.jobLocation,
      jobDescription: input.jobDescription,
      offerAmount: input.offerAmount,
      startDate: input.startDate,
    },
  });

  const candidateEmail = values.candidateEmail ?? "";

  const fire = await fireTemplatedEmail({
    trigger: input.trigger,
    userId,
    fromEmail,
    fromName,
    to: input.to,
    cc: input.cc ?? [],
    values,
    mode: input.mode ?? "send",
  });

  return { fire, candidateEmail };
}

function normalizeCandidateEmail(c: import("@/lib/recruiterflow").RFCandidate): string {
  if (Array.isArray(c.email)) return c.email[0] ?? "";
  return c.email ?? "";
}

async function logFire(args: {
  candidateRfId: number;
  actionType: string;
  metadata: Record<string, unknown>;
  fire: FireResult;
  userId: string;
}): Promise<void> {
  try {
    await createActionLog({
      userId: args.userId,
      actionType: args.actionType,
      subjectType: "candidate",
      subjectId: String(args.candidateRfId),
      metadata: {
        ...args.metadata,
        fireStatus: args.fire.status,
        fireDetail:
          args.fire.status === "sent"
            ? { gmailMessageId: args.fire.result.id, gmailThreadId: args.fire.result.threadId, subject: args.fire.subject }
            : args.fire.status === "drafted"
              ? { gmailDraftId: args.fire.result.id, gmailThreadId: args.fire.result.threadId, subject: args.fire.subject }
              : args.fire.status === "skipped"
                ? { reason: args.fire.reason }
                : { error: args.fire.error },
      },
    });
  } catch {
    // ActionLog failures never block an email. Silent.
  }
}

// ---- Candidate Rejection email ----

export type SendRejectionEmailInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  clientCompanyName: string;
};

export type RejectionEmailResult = {
  status: FireResult["status"];
  subject?: string;
  to?: string;
  reason?: string;
  error?: string;
};

export async function sendRejectionEmail(input: SendRejectionEmailInput): Promise<Result<RejectionEmailResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const c = await getRfCandidateByRfId(input.candidateRfId);
    const candidateEmail = c ? normalizeCandidateEmail(c) : "";
    if (!candidateEmail) {
      return {
        ok: true,
        value: { status: "skipped", reason: "no_recipient" },
      };
    }
    const outcome = await fireTriggerForCandidateJob({
      trigger: CANDIDATE_REJECTION_TRIGGER,
      candidateRfId: input.candidateRfId,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      jobTitle: input.jobTitle,
      clientCompanyName: input.clientCompanyName,
      to: [candidateEmail],
    });
    await logFire({
      candidateRfId: input.candidateRfId,
      actionType: "candidate_rejection_email",
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        to: candidateEmail,
      },
      fire: outcome.fire,
      userId,
    });
    return { ok: true, value: toRejectionResult(outcome.fire, candidateEmail) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rejection email failed." };
  }
}

function toRejectionResult(fire: FireResult, to: string): RejectionEmailResult {
  switch (fire.status) {
    case "sent":
      return { status: "sent", subject: fire.subject, to };
    case "drafted":
      return { status: "drafted", subject: fire.subject, to };
    case "skipped":
      return { status: "skipped", reason: fire.reason };
    case "error":
      return { status: "error", error: fire.error };
  }
}

// ---- Offer Acceptance email ----

export type SendOfferAcceptanceInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  clientCompanyName: string;
  clientContactFullName?: string;
  clientContactFirstName?: string;
  offerAmount: string;
  startDate: string;
  to: string[];
};

export async function sendOfferAcceptanceEmail(
  input: SendOfferAcceptanceInput,
): Promise<Result<RejectionEmailResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const c = await getRfCandidateByRfId(input.candidateRfId);
    const candidateEmail = c ? normalizeCandidateEmail(c) : "";
    const outcome = await fireTriggerForCandidateJob({
      trigger: OFFER_ACCEPTANCE_TRIGGER,
      candidateRfId: input.candidateRfId,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      jobTitle: input.jobTitle,
      clientCompanyName: input.clientCompanyName,
      clientContactFullName: input.clientContactFullName,
      clientContactFirstName: input.clientContactFirstName,
      offerAmount: input.offerAmount,
      startDate: input.startDate,
      to: input.to,
      cc: candidateEmail ? [candidateEmail] : [],
    });
    await logFire({
      candidateRfId: input.candidateRfId,
      actionType: "offer_acceptance_email",
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        to: input.to,
        cc: candidateEmail ? [candidateEmail] : [],
        offerAmount: input.offerAmount,
        startDate: input.startDate,
      },
      fire: outcome.fire,
      userId,
    });
    return { ok: true, value: toRejectionResult(outcome.fire, input.to[0] ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Offer acceptance email failed." };
  }
}

// ---- Interview Confirmation email ----

export type SendInterviewConfirmationInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobTitle: string;
  jobLocation?: string;
  jobDescription?: string;
  clientCompanyName: string;
  scheduledAt: string; // ISO
};

export async function sendInterviewConfirmationEmail(
  input: SendInterviewConfirmationInput,
): Promise<Result<RejectionEmailResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const c = await getRfCandidateByRfId(input.candidateRfId);
    const candidateEmail = c ? normalizeCandidateEmail(c) : "";
    if (!candidateEmail) {
      return { ok: true, value: { status: "skipped", reason: "no_recipient" } };
    }
    let jobDescription = input.jobDescription?.trim() ? input.jobDescription : "";
    let jobLocation = input.jobLocation ?? "";
    if (!jobDescription || !jobLocation) {
      try {
        const j = await recruiterflow.getJob(input.jobRfId);
        if (!jobDescription) {
          const raw = j as unknown as { description?: string; job_description?: string };
          jobDescription = (raw.description ?? raw.job_description ?? "").toString();
        }
        if (!jobLocation) {
          jobLocation = Array.isArray(j.locations) && j.locations.length > 0 ? j.locations.join(", ") : "";
        }
      } catch {
        // Non-fatal — template renders [Job Description] as empty.
      }
    }
    const outcome = await fireTriggerForCandidateJob({
      trigger: INTERVIEW_CONFIRMATION_TRIGGER,
      candidateRfId: input.candidateRfId,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      jobTitle: input.jobTitle,
      jobLocation,
      jobDescription,
      clientCompanyName: input.clientCompanyName,
      to: [candidateEmail],
    });
    await logFire({
      candidateRfId: input.candidateRfId,
      actionType: "interview_confirmation_email",
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        to: candidateEmail,
        scheduledAt: input.scheduledAt,
      },
      fire: outcome.fire,
      userId,
    });
    return { ok: true, value: toRejectionResult(outcome.fire, candidateEmail) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Interview confirmation email failed." };
  }
}

// ---- Reference Check Request ----

export type RequestReferencesInput = {
  candidateRfId: number;
  jobRfId?: number;
  clientRfId?: number;
  jobTitle?: string;
  clientCompanyName?: string;
};

export async function sendReferenceCheckRequest(
  input: RequestReferencesInput,
): Promise<Result<RejectionEmailResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const c = await getRfCandidateByRfId(input.candidateRfId);
    const candidateEmail = c ? normalizeCandidateEmail(c) : "";
    if (!candidateEmail) {
      return { ok: true, value: { status: "skipped", reason: "no_recipient" } };
    }
    const outcome = await fireTriggerForCandidateJob({
      trigger: REFERENCE_CHECK_REQUEST_TRIGGER,
      candidateRfId: input.candidateRfId,
      jobRfId: input.jobRfId,
      clientRfId: input.clientRfId,
      jobTitle: input.jobTitle,
      clientCompanyName: input.clientCompanyName,
      to: [candidateEmail],
    });
    await logFire({
      candidateRfId: input.candidateRfId,
      actionType: "reference_check_request_email",
      metadata: {
        jobRfId: input.jobRfId ?? null,
        clientRfId: input.clientRfId ?? null,
        to: candidateEmail,
      },
      fire: outcome.fire,
      userId,
    });
    revalidatePath(`/candidates/${input.candidateRfId}`);
    return { ok: true, value: toRejectionResult(outcome.fire, candidateEmail) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reference check email failed." };
  }
}

// ---- Keep ----
//
// "Keep" flags a candidate as worth holding onto for future roles — a
// recruiter signal, not a stage move. Source of truth lives in Postgres
// (an ActionLog row of type "keep"); we deliberately don't push to RF
// because RF doesn't have a first-class "kept" concept (it's a tag) and
// the no-RF-on-create rule extends to anything we're newly authoring in
// Ace. The Job-detail pipeline reads the most recent "keep" log per
// (candidate, job) pair to render an indicator badge if needed later.
export type KeepCandidateInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobCuid?: string | null;
  clientCuid?: string | null;
};

export async function keepCandidate(input: KeepCandidateInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: input.jobRfId,
    jobCuid: input.jobCuid,
    clientRfId: input.clientRfId,
    clientCuid: input.clientCuid,
    organizationId: org.id,
  });
  try {
    // Placement.upsert and ActionLog.create are independent — the upsert
    // doesn't need the log row (it only references candidateRfId/jobRfId/
    // clientRfId, all of which come from input) and vice versa. Running
    // them in parallel cuts one round-trip to Neon off the critical path.
    // Persist Placement.stage="kept" so the Applicants > Kept tab can
    // surface the row. Earlier the action only wrote ActionLog, so the
    // Kept tab's Placement-stage query came back empty and Keep felt
    // like a no-op to the recruiter.
    await Promise.all([
      prisma.placement.upsert({
        where: {
          candidateRfId_jobRfId: {
            candidateRfId: input.candidateRfId,
            jobRfId: input.jobRfId,
          },
        },
        create: {
          candidateRfId: input.candidateRfId,
          jobRfId: input.jobRfId,
          jobId,
          clientRfId: input.clientRfId,
          clientId,
          stage: "kept",
          createdById: userId,
          organizationId: org.id,
          syncedToRf: false,
        },
        update: {
          stage: "kept",
          syncedToRf: false,
        },
      }),
      createActionLog({
        userId,
        actionType: "keep",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
        },
      }),
    ]);
    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/jobs/${input.jobRfId}`);
    revalidatePath(`/applicants`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to keep candidate." };
  }
}

// ---- Stage reversions ----
//
// "Move to Kept" / "Move to Applied" are explicit stage reversions
// initiated from the candidate-profile / job-pipeline rows. They DO
// NOT call any external system (no email, no client notification,
// no RF write) — pure local-Postgres stage flips with an audit log
// entry that captures who reverted, when, and from what.
//
// Distinguished from keepCandidate / applyCandidateToJob in two
// ways: (1) the ActionLog actionType is "revert_to_kept" /
// "revert_to_applied" so activity feeds can present the move as a
// pull-back rather than a fresh keep/apply, and (2) the stage
// guard intentionally allows transitions from any non-terminal
// stage (kept ⇄ applied ⇄ submitted is the supported space).

export type StageReversionInput = {
  candidateRfId: number;
  jobRfId: number;
  clientRfId: number;
  jobCuid?: string | null;
  clientCuid?: string | null;
  previousStage: string;
};

async function flipPlacementStage(args: {
  userId: string;
  organizationId: string;
  input: StageReversionInput;
  toStage: "kept" | "applied";
  actionType: "revert_to_kept" | "revert_to_applied";
}): Promise<Result> {
  const { jobId, clientId } = await resolveCuidFks({
    jobRfId: args.input.jobRfId,
    jobCuid: args.input.jobCuid,
    clientRfId: args.input.clientRfId,
    clientCuid: args.input.clientCuid,
    organizationId: args.organizationId,
  });
  try {
    // Parallel insert — the two writes are independent (see keepCandidate
    // for the same pattern and reasoning).
    await Promise.all([
      prisma.placement.upsert({
        where: {
          candidateRfId_jobRfId: {
            candidateRfId: args.input.candidateRfId,
            jobRfId: args.input.jobRfId,
          },
        },
        create: {
          candidateRfId: args.input.candidateRfId,
          jobRfId: args.input.jobRfId,
          jobId,
          clientRfId: args.input.clientRfId,
          clientId,
          stage: args.toStage,
          createdById: args.userId,
          organizationId: args.organizationId,
          syncedToRf: false,
        },
        update: {
          stage: args.toStage,
          syncedToRf: false,
        },
      }),
      createActionLog({
        userId: args.userId,
        actionType: args.actionType,
        subjectType: "candidate",
        subjectId: String(args.input.candidateRfId),
        metadata: {
          jobRfId: args.input.jobRfId,
          clientRfId: args.input.clientRfId,
          fromStage: args.input.previousStage,
          toStage: args.toStage,
        },
      }),
    ]);
    revalidatePath(`/candidates/${args.input.candidateRfId}`);
    revalidatePath(`/jobs/${args.input.jobRfId}`);
    revalidatePath(`/applicants`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stage reversion failed." };
  }
}

export async function moveToKept(input: StageReversionInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  return flipPlacementStage({ userId, organizationId: org.id, input, toStage: "kept", actionType: "revert_to_kept" });
}

export async function moveToApplied(input: StageReversionInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  return flipPlacementStage({ userId, organizationId: org.id, input, toStage: "applied", actionType: "revert_to_applied" });
}
