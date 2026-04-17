"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    revalidatePath(`/inbox`);
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
    revalidatePath(`/inbox`);
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
    revalidatePath(`/inbox`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to confirm start." };
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
    revalidatePath(`/inbox`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
