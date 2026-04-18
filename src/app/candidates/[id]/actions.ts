"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const s = await getServerSession(authOptions);
  return Boolean(s?.user?.email);
}

export type CandidatePatch = Parameters<typeof recruiterflow.updateCandidate>[0];

// Thin wrapper so every editable section can save through the same path. The
// action takes any subset of fields; RF's /candidate/update ignores unknown
// fields and leaves omitted fields alone. `revalidatePath` refreshes the
// cached server component on return.
export async function updateCandidate(patch: CandidatePatch): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!patch.id || typeof patch.id !== "number") return { ok: false, error: "Missing candidate id." };

  try {
    const res = (await recruiterflow.updateCandidate(patch)) as { RESULT?: string };
    if (res && typeof res === "object" && "RESULT" in res && res.RESULT && res.RESULT !== "SUCCESS") {
      return { ok: false, error: `RecruiterFlow returned ${res.RESULT}` };
    }
    revalidatePath(`/candidates/${patch.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update candidate." };
  }
}

export async function deleteCandidateResume(candidateRfId: number): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!Number.isFinite(candidateRfId)) return { ok: false, error: "Missing candidate id." };

  try {
    await prisma.candidateResume.deleteMany({ where: { candidateRfId } });
    revalidatePath(`/candidates/${candidateRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete resume." };
  }
}
