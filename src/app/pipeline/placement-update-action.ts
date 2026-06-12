"use server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  normalizePlacementCompensationType,
  type PlacementCompensationType,
} from "@/lib/placement-compensation";
import { revalidatePlacementSurfaces } from "@/lib/placement-surfaces";
import { prisma } from "@/lib/prisma";

// Edit drawer save action invoked from the pipeline placement-edit
// drawer. Org-scoped — the existence check filters by organizationId
// so a stray placementId from another tenant can't be mutated. Only
// the fields the drawer renders as editable are written; everything
// else on the placement row is left untouched.
export type UpdatePlacementInput = {
  placementId: string;
  // <input type="date"> emits "YYYY-MM-DD". An empty string clears the
  // field. Anything else gets parsed and stored as a Date.
  expectedStartDate: string | null;
  acceptedSalary: number | null;
  acceptedCompensationType?: PlacementCompensationType | null;
  feeTotal: number | null;
  feePercentage: number | null;
  placementNotes: string | null;
  candidateSource: string | null;
  // Free-form per-placement city override. Null clears the override
  // so the dashboard falls back to client.location.city.
  cityOverride: string | null;
  // Custom payment terms. When useCustomTerms is true the recruiter has
  // overridden the default fee/guarantee handling with an explicit
  // installment schedule (1-3 payments) keyed off the confirmed start
  // date, and/or a custom guarantee end date. All optional: a field left
  // out of the input is not touched on the row (Prisma treats undefined
  // as "leave unchanged"), so existing callers that don't send these stay
  // valid. A null clears a field. customGuaranteeDate follows the same
  // "YYYY-MM-DD" / empty-clears convention as expectedStartDate.
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

type Result = { ok: true } | { ok: false; error: string };

export async function updatePlacement(
  input: UpdatePlacementInput,
): Promise<Result> {
  try {
    const org = await getCurrentOrg();
    const existing = await prisma.placement.findFirst({
      where: { id: input.placementId, organizationId: org.id },
      select: { id: true, candidateId: true },
    });
    if (!existing) {
      return { ok: false, error: "Placement not found in this organization" };
    }

    let parsedDate: Date | null = null;
    if (input.expectedStartDate && input.expectedStartDate.trim()) {
      const d = new Date(input.expectedStartDate);
      if (Number.isFinite(d.getTime())) parsedDate = d;
    }

    const trimmedNotes = input.placementNotes?.trim() ?? "";
    const trimmedSource = input.candidateSource?.trim() ?? "";
    const trimmedCity = input.cityOverride?.trim() ?? "";

    // undefined => key absent => leave the column unchanged. A provided
    // null or empty string clears it; a valid date string sets it.
    let parsedGuaranteeDate: Date | null | undefined = undefined;
    if (input.customGuaranteeDate !== undefined) {
      parsedGuaranteeDate = null;
      if (input.customGuaranteeDate && input.customGuaranteeDate.trim()) {
        const d = new Date(input.customGuaranteeDate);
        if (Number.isFinite(d.getTime())) parsedGuaranteeDate = d;
      }
    }

    await prisma.placement.update({
      where: { id: existing.id },
      data: {
        expectedStartDate: parsedDate,
        acceptedSalary: input.acceptedSalary,
        acceptedCompensationType:
          input.acceptedCompensationType == null
            ? undefined
            : normalizePlacementCompensationType(input.acceptedCompensationType),
        feeTotal: input.feeTotal,
        feePercentage: input.feePercentage,
        placementNotes: trimmedNotes ? trimmedNotes : null,
        candidateSource: trimmedSource ? trimmedSource : null,
        cityOverride: trimmedCity ? trimmedCity : null,
        useCustomTerms: input.useCustomTerms,
        installmentCount: input.installmentCount,
        inst1Amount: input.inst1Amount,
        inst1DaysAfterStart: input.inst1DaysAfterStart,
        inst2Amount: input.inst2Amount,
        inst2DaysAfterStart: input.inst2DaysAfterStart,
        inst3Amount: input.inst3Amount,
        inst3DaysAfterStart: input.inst3DaysAfterStart,
        customGuaranteeDate: parsedGuaranteeDate,
      },
    });

    // Fan out to every surface this edit can move — dashboard
    // (Placements tab + map + Momentum + Offer-to-Start), Placements
    // ledger, Pipeline, Finances cash forecast, candidate profile, and
    // the per-client placements list. Pre-fix: /placements,
    // /finances, and /clients/[id] kept reading stale renders until
    // the next manual hit.
    await revalidatePlacementSurfaces(existing.id, org.id);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Update failed",
    };
  }
}
