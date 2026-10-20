"use server";

// Mark a placement as fallen off (the candidate started and then left), or
// clear that mark. This is NOT Cancel: the row keeps its stage, its fee and
// its invoices, and stays on every dashboard. See src/lib/placement-fell-off.ts
// for the distinction. A refund amount books as a negative billing event
// (src/lib/billing-events.ts, refundEvent) so Revenue and Collected read net.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { createActionLog } from "@/lib/action-log";
import { prisma } from "@/lib/prisma";
import { revalidatePlacementSurfaces } from "@/lib/placement-surfaces";
import {
  normalizeFellOffReason,
  type FellOffReason,
} from "@/lib/placement-fell-off";

export type MarkFellOffInput = {
  placementId: string;
  // "YYYY-MM-DD" from a date input. Required: a fall-off always has a day.
  fellOffAt: string;
  reason: FellOffReason;
  notes: string;
  replacementOwed: boolean;
  // Whole dollars sent back to the client. Null or 0 means no refund.
  refundAmount: number | null;
  // "YYYY-MM-DD". Ignored when refundAmount is empty; defaults to fellOffAt.
  refundedAt: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

function parseDateOnly(value: string | null | undefined): Date | null {
  const t = value?.trim();
  if (!t) return null;
  // Date-only values are stored at midnight UTC, the convention every other
  // placement date follows (expectedStartDate, customGuaranteeDate).
  const d = new Date(`${t.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function currentUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function markPlacementFellOff(input: MarkFellOffInput): Promise<Result> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Not signed in." };
    const org = await getCurrentOrg();
    const existing = await prisma.placement.findFirst({
      where: { id: input.placementId, organizationId: org.id },
      select: { id: true, stage: true, feeTotal: true, candidateId: true },
    });
    if (!existing) return { ok: false, error: "Placement not found in this organization." };
    if (existing.stage !== "hired") {
      return {
        ok: false,
        error: "Only a candidate who has started can fall off. Use Cancel for a deal that never happened.",
      };
    }

    const fellOffAt = parseDateOnly(input.fellOffAt);
    if (!fellOffAt) return { ok: false, error: "Enter the date the candidate left." };

    let refundAmount: number | null = null;
    if (input.refundAmount != null && Number.isFinite(input.refundAmount)) {
      const r = Math.round(input.refundAmount);
      if (r < 0) return { ok: false, error: "Refund amount cannot be negative." };
      if (existing.feeTotal != null && r > existing.feeTotal) {
        return {
          ok: false,
          error: `Refund cannot exceed the $${existing.feeTotal.toLocaleString("en-US")} fee on this placement.`,
        };
      }
      refundAmount = r > 0 ? r : null;
    }
    const refundedAt = refundAmount ? (parseDateOnly(input.refundedAt) ?? fellOffAt) : null;
    const reason = normalizeFellOffReason(input.reason);
    const notes = input.notes.trim() || null;

    await prisma.placement.update({
      where: { id: existing.id },
      data: {
        fellOffAt,
        fellOffReason: reason,
        fellOffNotes: notes,
        replacementOwed: Boolean(input.replacementOwed),
        refundAmount,
        refundedAt,
      },
    });

    await createActionLog({
      userId,
      actionType: "placement_fell_off",
      // Logged against the candidate when the row has an Ace-native one,
      // otherwise against the placement itself.
      subjectType: existing.candidateId ? "candidate" : "placement",
      subjectId: existing.candidateId ?? existing.id,
      metadata: {
        placementId: existing.id,
        fellOffAt: fellOffAt.toISOString(),
        reason,
        replacementOwed: Boolean(input.replacementOwed),
        refundAmount,
        refundedAt: refundedAt?.toISOString() ?? null,
      },
    });

    await revalidatePlacementSurfaces(existing.id, org.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

export async function clearPlacementFellOff(placementId: string): Promise<Result> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Not signed in." };
    const org = await getCurrentOrg();
    const existing = await prisma.placement.findFirst({
      where: { id: placementId, organizationId: org.id },
      select: { id: true, candidateId: true },
    });
    if (!existing) return { ok: false, error: "Placement not found in this organization." };

    await prisma.placement.update({
      where: { id: existing.id },
      data: {
        fellOffAt: null,
        fellOffReason: null,
        fellOffNotes: null,
        replacementOwed: false,
        refundAmount: null,
        refundedAt: null,
      },
    });
    await createActionLog({
      userId,
      actionType: "placement_fell_off_cleared",
      subjectType: existing.candidateId ? "candidate" : "placement",
      subjectId: existing.candidateId ?? existing.id,
      metadata: { placementId: existing.id },
    });
    await revalidatePlacementSurfaces(existing.id, org.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
