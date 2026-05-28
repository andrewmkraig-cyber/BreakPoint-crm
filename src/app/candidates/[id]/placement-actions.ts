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
import { getResumeBytes } from "@/lib/resume-bytes";
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
import { fireTriggerAndLog } from "@/lib/trigger-fire";
import { upsertMatchScore } from "@/lib/match-scoring-store";
import { revalidatePlacementSurfaces } from "@/lib/placement-surfaces";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { formatLocation } from "@/lib/utils";
import { formatCompensation, type RFJob } from "@/lib/rf-payload-shapes";
import { createInvoiceForPlacement } from "@/lib/invoices";
import { createDraftInvoiceAction } from "@/app/invoices/actions";
import { createReminder } from "@/app/calendar/reminder-actions";
import { zonedWallTimeToUtc } from "@/lib/timezone";
import {
  CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
  CANDIDATE_CONFIRMATION_TRIGGER,
  CANDIDATE_HIRED_WELCOME_TRIGGER,
  CANDIDATE_REJECTION_TRIGGER,
  OFFER_ACCEPTANCE_TRIGGER,
  OFFER_EXTENDED_TRIGGER,
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
    reason: "RF /external doesn't expose pipeline stage changes. Ace-only.",
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
  // Fee terms locked in at offer time. feeTotal is required (>0) because
  // the Scoreboard Pipeline Value KPI sums it across offer + pending_start
  // rows — a null fee silently drops the deal out of the forecast.
  feePercentage: number | null;
  feeTotal: number;
  minFee: number | null;
};

export async function recordOffer(input: RecordOfferInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  // Server-side guard so the dialog's input-layer + submit checks can't be
  // bypassed (Ace fix 2026-05-27). Salary and feePercentage are the two
  // recruiter-typed numerics that show up downstream on invoices / KPIs —
  // a stray negative would silently break the Pipeline Value sum and the
  // invoice math. minFee / feeTotal are derived from the same inputs and
  // are already gated by the feeTotal > 0 check below.
  if (input.salary != null && input.salary < 0) {
    return { ok: false, error: "Salary can't be negative." };
  }
  if (input.feePercentage != null && input.feePercentage < 0) {
    return { ok: false, error: "Fee percentage can't be negative." };
  }
  if (input.feeTotal == null || input.feeTotal <= 0) {
    return { ok: false, error: "Fee amount is required at this stage." };
  }
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
        // Mirror offered salary into acceptedSalary at offer time so the
        // Hired-tab Salary column is populated even if PlacementDialog isn't
        // opened to type it in again. PlacementDialog still wins on edit
        // (its own save call writes acceptedSalary explicitly).
        acceptedSalary: input.salary ?? null,
        acceptedCurrency: input.currency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
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
        acceptedSalary: input.salary ?? null,
        acceptedCurrency: input.currency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
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

    // Auto-fire the Offer Extended template to the candidate.
    // Identity-agnostic: routes through fireTriggerAndLog so a future
    // Ace-native offer flow that passes jobCuid/clientCuid (and
    // eventually candidateId) Just Works without re-plumbing.
    const offerAmount = input.salary
      ? formatCurrencyInline(input.salary, input.currency || "USD")
      : "";
    const startDateLabel = input.startDate
      ? new Date(input.startDate).toLocaleDateString()
      : "";
    await fireTriggerAndLog({
      trigger: OFFER_EXTENDED_TRIGGER,
      ref: {
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        jobId: input.jobCuid ?? null,
        clientRfId: input.clientRfId,
        clientId: input.clientCuid ?? null,
      },
      actionType: "offer_extended_email",
      organizationId: org.id,
      overrides: {
        offerAmount,
        startDate: startDateLabel,
        jobTitle: input.title,
      },
      metadata: {
        placementId: row.id,
        offerAmount,
        startDate: startDateLabel,
      },
    });

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
  // Multi-contact hiring manager list. Optional; mirrors the billingContacts
  // pattern — the first entry is mirrored into hiringManagerName/Email and
  // the full list is stored in the Placement.hiringContacts JSON column.
  hiringContacts?: Array<{ name: string; email: string }>;
  expectedStartDate: string; // ISO
  notes: string;
  // Recruiter-tagged lead source — drives the dashboard's By Source
  // bucketing. Free-form so legacy values (Pin, Apollo BD) survive; the
  // modal renders a fixed dropdown for the canonical channels.
  candidateSource?: string | null;
  // Custom Payment Agreement (Ace fix 2026-05-26 - PlacementDialog parity
  // with placement-edit-drawer.tsx). All optional: a caller that doesn't
  // know about custom terms can omit them and the existing default
  // behavior (single-invoice, default guarantee window) is preserved.
  // customGuaranteeDate is an ISO YYYY-MM-DD string; the server parses
  // and stores it as a Date.
  useCustomTerms?: boolean;
  installmentCount?: number | null;
  inst1Amount?: number | null;
  inst1DaysAfterStart?: number | null;
  inst2Amount?: number | null;
  inst2DaysAfterStart?: number | null;
  inst3Amount?: number | null;
  inst3DaysAfterStart?: number | null;
  customGuaranteeDate?: string | null;
};

export async function recordPlacement(input: RecordPlacementInput): Promise<Result<{ id: string; syncedToRf: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.expectedStartDate) return { ok: false, error: "Expected start date is required." };
  if (input.feeTotal == null || input.feeTotal <= 0) {
    return { ok: false, error: "Fee amount is required at this stage." };
  }
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
    // Same normalize / mirror logic for the hiring-manager list. The first
    // entry mirrors into hiringManagerName / hiringManagerEmail so single-
    // contact readers (Pipeline, invoice, gmail-recipients) stay correct.
    const cleanedHiring = (input.hiringContacts ?? [])
      .map((c) => ({ name: (c.name ?? "").trim(), email: (c.email ?? "").trim() }))
      .filter((c) => c.name || c.email);
    const primaryHiring = cleanedHiring[0] ?? null;
    const mirroredHiringName = primaryHiring?.name || input.hiringManagerName || null;
    const mirroredHiringEmail = primaryHiring?.email || input.hiringManagerEmail || null;
    const trimmedSource = input.candidateSource?.trim();
    // Custom Payment Agreement payload. Only write the custom-term columns
    // when the caller actually sent them, otherwise leave them untouched so
    // an existing row that already has saved terms can't be wiped by a
    // caller that doesn't know about them. Mirrors the placement-update
    // action's conditional handling.
    const termsLoaded = input.useCustomTerms !== undefined;
    const useCustomTerms = input.useCustomTerms ?? false;
    const customGuaranteeDateValue =
      termsLoaded && useCustomTerms && input.customGuaranteeDate?.trim()
        ? new Date(input.customGuaranteeDate)
        : termsLoaded
          ? null
          : undefined;
    const termsPayload = termsLoaded
      ? {
          useCustomTerms,
          installmentCount: useCustomTerms ? input.installmentCount ?? null : null,
          inst1Amount: useCustomTerms ? input.inst1Amount ?? null : null,
          inst1DaysAfterStart: useCustomTerms ? input.inst1DaysAfterStart ?? null : null,
          inst2Amount:
            useCustomTerms && (input.installmentCount ?? 0) >= 2
              ? input.inst2Amount ?? null
              : null,
          inst2DaysAfterStart:
            useCustomTerms && (input.installmentCount ?? 0) >= 2
              ? input.inst2DaysAfterStart ?? null
              : null,
          inst3Amount:
            useCustomTerms && (input.installmentCount ?? 0) >= 3
              ? input.inst3Amount ?? null
              : null,
          inst3DaysAfterStart:
            useCustomTerms && (input.installmentCount ?? 0) >= 3
              ? input.inst3DaysAfterStart ?? null
              : null,
          customGuaranteeDate: customGuaranteeDateValue,
        }
      : {};
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
      hiringManagerName: mirroredHiringName,
      hiringManagerEmail: mirroredHiringEmail,
      hiringContacts: cleanedHiring.length > 0 ? cleanedHiring : Prisma.JsonNull,
      expectedStartDate: new Date(input.expectedStartDate),
      placementNotes: input.notes || null,
      candidateSource: trimmedSource ? trimmedSource : null,
      syncedToRf: sync.synced,
      ...termsPayload,
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

    // Auto-update the candidate's displayed comp from the accepted salary.
    // The profile's "Expected compensation" row reads from both the
    // top-level Candidate.expectedSalary column AND raw.expected_salary
    // (the snake_case mirror inside Candidate.raw — see actions.ts
    // updateCandidate lines 129-131 + 144-150 for the canonical write
    // shape), so we update both here to stay in parity with the manual
    // edit flow.
    //
    // Guards: only fire when acceptedSalary is a positive number, and
    // skip when the candidate's existing comp already matches that value
    // so a no-op edit isn't a redundant write. A null/zero/missing
    // acceptedSalary falls through entirely — the existing comp is never
    // wiped by a placement save that didn't capture a salary.
    if (
      typeof input.acceptedSalary === "number" &&
      input.acceptedSalary > 0
    ) {
      const candidateRow = await prisma.candidate.findFirst({
        where: { rfId: input.candidateRfId, organizationId: org.id },
        select: { id: true, raw: true, expectedSalary: true },
      });
      if (candidateRow) {
        // Read the current displayed number off raw.expected_salary first
        // (that's the source the profile actually renders); fall back to
        // the top-level column if raw doesn't carry the key yet.
        const rawObj =
          (candidateRow.raw as Record<string, unknown> | null) ?? {};
        const rawSalary = rawObj.expected_salary as
          | { number?: number | null; currency?: string | null }
          | null
          | undefined;
        const columnSalary = candidateRow.expectedSalary as
          | { number?: number | null; currency?: string | null }
          | null
          | undefined;
        const currentNumber =
          (typeof rawSalary?.number === "number" ? rawSalary.number : null) ??
          (typeof columnSalary?.number === "number"
            ? columnSalary.number
            : null);
        if (currentNumber !== input.acceptedSalary) {
          const newExpectedSalary = {
            number: input.acceptedSalary,
            currency: (input.acceptedCurrency || "USD")
              .toUpperCase()
              .slice(0, 3),
          };
          const nextRaw: Record<string, unknown> = {
            ...rawObj,
            expected_salary: newExpectedSalary,
          };
          await prisma.candidate.update({
            where: { id: candidateRow.id },
            data: {
              expectedSalary: newExpectedSalary as Prisma.InputJsonValue,
              raw: nextRaw as Prisma.InputJsonValue,
            },
          });
        }
      }
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

// Surfaced to the Confirm Start UI so it can tailor the success toast.
// customTermsFired is true when the placement carried a custom payment
// agreement (so an installment-1 draft was created); remindersSet is the
// number of later-installment reminders (2 + 3) that apply.
// invoiceId is the just-created draft invoice's id (full-fee on the
// non-custom path, installment-1 on the custom path) so the client can
// pop the invoice email composer pre-loaded against that invoice. null
// when the draft creation failed (already logged server-side; the
// Confirm Start itself still succeeded).
export type ConfirmStartResult = {
  customTermsFired: boolean;
  remindersSet: number;
  invoiceId: string | null;
};

export async function confirmStart(
  input: ConfirmStartInput,
): Promise<Result<ConfirmStartResult>> {
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
    const placement = await prisma.placement.findUnique({
      where: { id: input.placementId },
      // candidateId added so the revalidatePath tail below can refresh
      // Ace-native candidate profiles (where candidateRfId is null).
      // Without this, confirming start on a local candidate leaves the
      // profile cached with the prior pending_start state — the pill
      // stays on "Confirm Start" until a hard reload.
      select: { candidateRfId: true, candidateId: true },
    });
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
        // Needed before the full-fee auto-draft below so we can suppress it
        // when this placement carries custom installment terms (the custom
        // path creates an installment-1 draft instead).
        useCustomTerms: true,
      },
    });
    if (!existing || existing.feeTotal == null || existing.feeTotal <= 0) {
      return { ok: false, error: "Fee amount is required at this stage." };
    }
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

    // Refresh both candidate-profile URL shapes. RF-imported placements
    // carry candidateRfId; Ace-native ones carry candidateId. We hit
    // whichever is populated so the pill on the profile picks up the
    // new "hired" stage without a hard reload.
    if (placement.candidateRfId != null) revalidatePath(`/candidates/${placement.candidateRfId}`);
    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    revalidatePath(`/pipeline`);

    // Auto-create a DRAFT invoice keyed to this placement so the
    // Invoicing tab and /invoices list have something to send. The
    // helper is idempotent — if an invoice already exists for this
    // placement, it returns the existing id instead of stacking
    // duplicates on re-uploads. We catch and log so a transient
    // failure here never breaks the Confirm Start flow.
    //
    // Suppressed when the placement uses custom installment terms: in that
    // case the custom-payment block below creates an installment-1 draft
    // instead, and a full-fee draft would double-bill. When useCustomTerms
    // is false or null this fires exactly as before.
    //
    // 2026-05-27: capture the resulting invoice id (or the existing one
    // when idempotent) so the Confirm Start UI can navigate the recruiter
    // straight to the composer-pop flow on /invoices/[id]?compose=1.
    let invoiceId: string | null = null;
    if (!existing.useCustomTerms) {
      try {
        const created = await createInvoiceForPlacement({
          placementId: input.placementId,
          organizationId: org.id,
        });
        invoiceId = created.id;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[confirmStart] invoice draft failed", {
          placementId: input.placementId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Auto-fire the Hired — Welcome / Next Steps template. Routes
    // through fireTriggerAndLog so it works for either candidate
    // type — RF or Ace-native — depending on which id shape the
    // placement carries. Re-reads the placement to pick up both
    // identity columns + job/client cuids in one round trip.
    const placementForFire = await prisma.placement.findUnique({
      where: { id: input.placementId },
      select: {
        candidateRfId: true,
        candidateId: true,
        jobRfId: true,
        jobId: true,
        clientRfId: true,
        clientId: true,
        expectedStartDate: true,
        // Custom payment agreement fields + names for the installment
        // trigger below. Selected here so non-custom placements don't pay
        // for a second round trip.
        startConfirmedAt: true,
        offerTitle: true,
        useCustomTerms: true,
        installmentCount: true,
        inst1Amount: true,
        inst1DaysAfterStart: true,
        inst2Amount: true,
        inst2DaysAfterStart: true,
        inst3Amount: true,
        inst3DaysAfterStart: true,
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true } },
      },
    });
    if (placementForFire) {
      const startDateLabel = placementForFire.expectedStartDate
        ? placementForFire.expectedStartDate.toLocaleDateString()
        : "";
      await fireTriggerAndLog({
        trigger: CANDIDATE_HIRED_WELCOME_TRIGGER,
        ref: {
          candidateRfId: placementForFire.candidateRfId,
          candidateId: placementForFire.candidateId,
          jobRfId: placementForFire.jobRfId,
          jobId: placementForFire.jobId,
          clientRfId: placementForFire.clientRfId,
          clientId: placementForFire.clientId,
        },
        actionType: "candidate_hired_welcome_email",
        organizationId: org.id,
        overrides: { startDate: startDateLabel },
        metadata: {
          placementId: input.placementId,
          startDate: startDateLabel,
        },
      });
    }

    // ---- Custom payment agreement trigger ----
    // Fires only when the recruiter attached custom installment terms to
    // this placement (set via the placement edit drawer). For every other
    // placement this block is a no-op and Confirm Start behaves exactly as
    // before. Wrapped in try/catch so a draft/reminder hiccup never breaks
    // the confirmation, mirroring the full-fee auto-draft above.
    let customTermsFired = false;
    let remindersSet = 0;
    if (
      placementForFire?.useCustomTerms &&
      (placementForFire.installmentCount ?? 0) >= 1 &&
      placementForFire.inst1Amount != null
    ) {
      customTermsFired = true;
      const count = placementForFire.installmentCount ?? 1;
      // Start date is stored as midnight UTC of the chosen day; read it in
      // UTC so "+ N days" lands on the intended calendar date regardless of
      // server timezone. Fall back to the just-stamped confirmation time.
      const base =
        placementForFire.expectedStartDate ??
        placementForFire.startConfirmedAt ??
        new Date();
      const baseY = base.getUTCFullYear();
      const baseM = base.getUTCMonth();
      const baseD = base.getUTCDate();
      const candidateName =
        [placementForFire.candidate?.firstName, placementForFire.candidate?.lastName]
          .filter((s): s is string => Boolean(s && s.trim()))
          .join(" ")
          .trim() || "Candidate";
      const clientName = placementForFire.client?.name?.trim() || "Client";

      // Installments 2 + 3 are the "remaining" ones surfaced in the toast;
      // count them from the terms so the message is stable on a re-fire.
      if (count >= 2 && placementForFire.inst2Amount != null) remindersSet += 1;
      if (count >= 3 && placementForFire.inst3Amount != null) remindersSet += 1;

      try {
        // (a) Installment 1 draft invoice. Idempotent: skip if THIS
        // placement already has its installment-1 draft so a re-fired
        // Confirm Start can't stack duplicates. The dedupe is keyed on
        // the "Installment 1 of " note prefix specifically — the new
        // future drafts (2 + 3) carry a "Future - Installment N of "
        // prefix, so a broader "custom payment agreement" match would
        // false-positive against them and silently skip installment 1.
        const existingInstallment = await prisma.invoice.findFirst({
          where: {
            placementId: input.placementId,
            organizationId: org.id,
            status: { not: "VOID" },
            notes: { contains: "Installment 1 of " },
          },
          select: { id: true },
        });
        if (existingInstallment) {
          // Re-fired Confirm Start with an existing installment-1 draft:
          // keep that id so the composer pop still lands on a real invoice.
          invoiceId = existingInstallment.id;
        } else {
          const draftRes = await createDraftInvoiceAction({
            placementId: input.placementId,
            candidateId: placementForFire.candidateId ?? null,
            clientId: placementForFire.clientId ?? null,
            roleTitle: placementForFire.offerTitle ?? null,
            startDate: new Date(Date.UTC(baseY, baseM, baseD)).toISOString(),
            dueDate: new Date(
              Date.UTC(baseY, baseM, baseD + (placementForFire.inst1DaysAfterStart ?? 0)),
            ).toISOString(),
            feeAmount: String(placementForFire.inst1Amount),
            notes: `Installment 1 of ${count} - custom payment agreement`,
          });
          if (!draftRes.ok) {
            // eslint-disable-next-line no-console
            console.error("[confirmStart] installment-1 draft failed", {
              placementId: input.placementId,
              error: draftRes.error,
            });
          } else {
            invoiceId = draftRes.data.id;
          }
        }

        // (b/c) Reminders for installments 2 and 3 at 9:00 AM ET on the due
        // day. Deduped by title so a re-fire doesn't stack reminders.
        const reminderSpecs: Array<{ n: number; amount: number; days: number }> = [];
        if (count >= 2 && placementForFire.inst2Amount != null) {
          reminderSpecs.push({
            n: 2,
            amount: placementForFire.inst2Amount,
            days: placementForFire.inst2DaysAfterStart ?? 0,
          });
        }
        if (count >= 3 && placementForFire.inst3Amount != null) {
          reminderSpecs.push({
            n: 3,
            amount: placementForFire.inst3Amount,
            days: placementForFire.inst3DaysAfterStart ?? 0,
          });
        }
        // Future installment drafts (2 + 3) sit alongside the reminders:
        // the reminder is the 9 AM ET nudge to send, the invoice is the
        // pre-staged DRAFT it points to. isFuture=true keeps them out of
        // the main Invoices list and routes them into the Future Invoices
        // section on /finances. Idempotent per installment number via a
        // stable note prefix so a re-fired Confirm Start can't duplicate.
        for (const spec of reminderSpecs) {
          const dueIso = new Date(
            Date.UTC(baseY, baseM, baseD + spec.days),
          ).toISOString();
          const dueLabel = new Date(dueIso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const futureNote = `Future - Installment ${spec.n} of ${count} - do not send until ${dueLabel} - custom payment agreement`;
          const existingFuture = await prisma.invoice.findFirst({
            where: {
              placementId: input.placementId,
              organizationId: org.id,
              status: { not: "VOID" },
              notes: { contains: `Future - Installment ${spec.n} of ` },
            },
            select: { id: true },
          });
          if (!existingFuture) {
            const futureRes = await createDraftInvoiceAction({
              placementId: input.placementId,
              candidateId: placementForFire.candidateId ?? null,
              clientId: placementForFire.clientId ?? null,
              roleTitle: placementForFire.offerTitle ?? null,
              startDate: new Date(Date.UTC(baseY, baseM, baseD)).toISOString(),
              dueDate: dueIso,
              feeAmount: String(spec.amount),
              notes: futureNote,
              isFuture: true,
            });
            if (!futureRes.ok) {
              // eslint-disable-next-line no-console
              console.error(`[confirmStart] installment-${spec.n} future draft failed`, {
                placementId: input.placementId,
                error: futureRes.error,
              });
            }
          }
        }
        for (const spec of reminderSpecs) {
          // AceReminder has no separate note field, so the amount + position
          // live in the title (the only text column createReminder writes).
          const title = `Invoice installment ${spec.n} - ${candidateName} / ${clientName} - $${spec.amount.toLocaleString("en-US")} due (${spec.n} of ${count})`;
          const dupe = await prisma.aceReminder.findFirst({
            where: { organizationId: org.id, title },
            select: { id: true },
          });
          if (dupe) continue;
          const remindAt = zonedWallTimeToUtc(
            base.getUTCFullYear(),
            base.getUTCMonth() + 1,
            base.getUTCDate() + spec.days,
            9,
            0,
            "America/New_York",
          );
          // notifyLeadsMin [0] => fire exactly at 9:00 AM ET, not before.
          await createReminder(title, remindAt.toISOString(), [0]);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[confirmStart] custom payment trigger failed", {
          placementId: input.placementId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ok: true, value: { customTermsFired, remindersSet, invoiceId } };
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
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization context." };

  try {
    // Rule 8: org-scoped lookup so a stray placementId from another tenant
    // can't probe candidate / client ids out of this org. findFirst (not
    // findUnique) because we need to AND organizationId onto the lookup.
    const existing = await prisma.placement.findFirst({
      where: { id: input.placementId, organizationId: org.id },
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

    // Bust every server-rendered surface a cancel affects: dashboard
    // metrics, placements ledger, pipeline tabs, finances cash forecast,
    // and the specific candidate / client pages. Replaces the old narrow
    // revalidatePath('/pipeline') + candidate-page only.
    await revalidatePlacementSurfaces(input.placementId, org.id);
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

    // Reapply now moves the cancelled row to "applied" stage so the
    // candidate appears on /applicants and the job pill stays visible
    // on their profile. Previous behavior (delete the row) wiped the
    // pill entirely and dropped them off Applicants.
    await prisma.placement.update({
      where: { id: input.placementId },
      data: { stage: "applied", syncedToRf: false, invoicingFlagged: false },
    });
    await createActionLog({
      userId,
      actionType: "reapply_cancelled_placement",
      subjectType: "candidate",
      subjectId: String(p.candidateRfId),
      metadata: { jobRfId: p.jobRfId, clientRfId: p.clientRfId, placementId: input.placementId, target: "applied" },
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

    // Phase 5: RF sync retired — Ace is the only source of truth.
    // Placement row is deleted; ActionLog captures the removal.
    await createActionLog({
      userId,
      actionType: "remove_cancelled_from_job",
      subjectType: "candidate",
      subjectId: String(p.candidateRfId),
      metadata: {
        jobRfId: p.jobRfId,
        clientRfId: p.clientRfId,
        placementId: input.placementId,
      },
    });
    revalidatePath(`/candidates/${p.candidateRfId}`);
    revalidatePath(`/pipeline`);
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

  // Phase 5: RF sync retired. Ace is the only source of truth. The
  // Placement row below is the canonical record; pipeline / job /
  // candidate-profile reads all resolve to this row's stage directly.
  const rfSynced = false;
  const rfError: string | null = null;

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
    if (!c) return { ok: false, error: "Candidate not found." };
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
      // Pre-pipeline stages (sourced / applied / kept) can all transition
      // to "applied" here — Apply is the natural promotion path off Kept
      // and a no-op refresh off Applied/Sourced. Anything past Applied
      // (submitted / interviewing / offer / hired / etc.) is a real
      // pipeline state we won't silently downgrade.
      const PRE_PIPELINE_STAGES = new Set(["sourced", "applied", "kept"]);
      if (!PRE_PIPELINE_STAGES.has(existing.stage)) {
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

  // Phase 5: RF sync retired. Ace's Placement row is the only source
  // of truth for the applied stage; no external write.
  const rfSynced = false;
  const rfError: string | null = null;

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

    // Deterministic match score on link. Same idempotent contract as
    // applyLocalCandidateToJob — skipped when the (candidate, job)
    // sourceHash matches what's already stored. No Claude call.
    if (jobId) {
      try {
        await upsertMatchScore({ orgId: org.id, candidateId: candidateRow.id, jobId });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[applyCandidateToJob] match-score upsert failed", { jobId, candidateId: candidateRow.id, err: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  revalidatePath(`/candidates/${input.candidateRfId}`);
  revalidatePath(`/pipeline`);
  revalidatePath(`/jobs/${input.jobRfId}`);

  // Auto-fire the Candidate Applied — Confirmation template (if the
  // recruiter has one active for this trigger). Best-effort: a missing
  // template / no candidate email / template fire error doesn't fail
  // the apply itself — the Placement row is already created and the
  // pipeline state is correct. Same pattern the rejection / offer-
  // acceptance flows use.
  try {
    const c = await getRfCandidateByRfId(input.candidateRfId);
    const candidateEmail = c ? normalizeCandidateEmail(c) : "";
    if (candidateEmail) {
      const outcome = await fireTriggerForCandidateJob({
        trigger: CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
        candidateRfId: input.candidateRfId,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        jobTitle: input.jobTitle,
        clientCompanyName: input.clientName,
        to: [candidateEmail],
      });
      await logFire({
        candidateRfId: input.candidateRfId,
        actionType: "candidate_applied_confirmation_email",
        metadata: {
          jobRfId: input.jobRfId,
          clientRfId: input.clientRfId,
          to: candidateEmail,
        },
        fire: outcome.fire,
        userId,
      });
    }
  } catch {
    // Silent — apply itself succeeded; trigger fire is observability.
  }

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
    if (!c) return { ok: false, error: "Candidate not found." };
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
  // Phase 5A.5.a: candidateRfId is no longer @unique; pick the most-
  // recent uploaded version for the submittal-attachment dropdown.
  const row = await prisma.candidateResume.findFirst({
    where: { candidateRfId, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
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
  if (!row) return { ok: true, value: [] };
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
  // Phase 5A.5.a: candidateRfId is no longer @unique; pick the most-
  // recent uploaded version for the submittal email attachment.
  const row = await prisma.candidateResume.findFirst({
    where: { candidateRfId, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
  });
  if (!row) {
    return { ok: false, error: "No resume uploaded for this candidate." };
  }
  if (variant === "branded") {
    // Post-Blob backfill: redactedData is null on migrated rows; bytes
    // moved to redactedBlobUrl. Either column counts as "has branded".
    if (!(row.redactedBlobUrl || row.redactedData) || !row.redactedAt) {
      return { ok: false, error: "No branded resume available for this candidate." };
    }
    const bytes = await getResumeBytes({
      blobUrl: row.redactedBlobUrl,
      data: row.redactedData,
    });
    return {
      ok: true,
      value: {
        filename: row.filename.replace(/\.pdf$/i, "") + "-BreakPoint.pdf",
        mimeType: row.redactedMimeType ?? "application/pdf",
        data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      },
    };
  }
  const bytes = await getResumeBytes(row);
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
  bcc?: string[];
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
      bcc: input.bcc,
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

  // Phase 5: RF push retired. The Placement row + ActionLog above are
  // the canonical record of the submittal.

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
        gmailDraftId: draft.draftId,
        gmailThreadId: draft.threadId,
      },
    });
    return { ok: true, value: { mode: "drafted", id: draft.messageId, threadId: draft.threadId } };
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

function normalizeCandidateEmail(c: import("@/lib/rf-payload-shapes").RFCandidate): string {
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

    // Deterministic match score on link. RF apply path stores
    // candidateRfId on Placement, so we resolve to candidateId (cuid)
    // for the CandidateMatch upsert. Skipped when no candidate row
    // exists yet (rare — every active recruiter target has a Candidate
    // row before they're keepable).
    if (jobId) {
      try {
        const c = await prisma.candidate.findFirst({
          where: { rfId: input.candidateRfId, organizationId: org.id },
          select: { id: true },
        });
        if (c) {
          await upsertMatchScore({ orgId: org.id, candidateId: c.id, jobId });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[keepCandidate] match-score upsert failed", { jobId, candidateRfId: input.candidateRfId, err: e instanceof Error ? e.message : String(e) });
      }
    }

    revalidatePath(`/candidates/${input.candidateRfId}`);
    revalidatePath(`/jobs/${input.jobRfId}`);
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


// Slim placement readback used by the Apply-to-Job optimistic flow to
// confirm the DB write committed without triggering a full RSC refresh.
// Returns one row per Placement for this candidate (org-scoped), enough
// for the job-strip merge to swap the optimistic id/stage for the server
// values. Stays minimal so the round-trip is fast — no joins, no RF
// hydration, just the columns the client merge actually consults.
export type CandidatePlacementSnapshotLite = {
  jobRfId: number | null;
  jobId: string | null;
  placementId: string;
  stage: string;
};

export async function getCandidatePlacementSnapshots(
  candidateRfId: number,
): Promise<Result<CandidatePlacementSnapshotLite[]>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  try {
    const rows = await prisma.placement.findMany({
      where: { candidateRfId, organizationId: org.id },
      select: { id: true, jobRfId: true, jobId: true, stage: true },
    });
    return {
      ok: true,
      value: rows.map((r) => ({
        jobRfId: r.jobRfId,
        jobId: r.jobId,
        placementId: r.id,
        stage: r.stage,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Snapshot fetch failed." };
  }
}

// Server-side currency formatter for trigger fires (the rich
// formatMoney variants live in client components and can't be
// imported here). Mirrors the "$120k" condensed form used elsewhere
// in the app for offer amounts.
function formatCurrencyInline(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "";
  const ccy = (currency || "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  if (amount >= 1000) {
    const k = amount / 1000;
    const fixed = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${symbol}${fixed}k`;
  }
  return `${symbol}${amount}`;
}
