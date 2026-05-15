"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
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
  feeTotal: number | null;
  feePercentage: number | null;
  placementNotes: string | null;
  candidateSource: string | null;
  // Free-form per-placement city override. Null clears the override
  // so the dashboard falls back to client.location.city.
  cityOverride: string | null;
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

    await prisma.placement.update({
      where: { id: existing.id },
      data: {
        expectedStartDate: parsedDate,
        acceptedSalary: input.acceptedSalary,
        feeTotal: input.feeTotal,
        feePercentage: input.feePercentage,
        placementNotes: trimmedNotes ? trimmedNotes : null,
        candidateSource: trimmedSource ? trimmedSource : null,
        cityOverride: trimmedCity ? trimmedCity : null,
      },
    });

    revalidatePath("/pipeline");
    // /dashboard hosts the Placements tab with the map — needs busting
    // so a cityOverride change shows up on the next render without a
    // hard refresh.
    revalidatePath("/dashboard");
    if (existing.candidateId) {
      revalidatePath(`/candidates/${existing.candidateId}`);
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Update failed",
    };
  }
}
