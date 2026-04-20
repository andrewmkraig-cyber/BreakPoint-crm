"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Local-only candidate field updates. RF candidates have a separate path
// in actions.ts (updateCandidate) that hits the RF API; this one writes
// to local Postgres only and is used by the Ace-local profile to fix up
// fields the resume parser missed (most often current title / employer).

type Result = { ok: true } | { ok: false; error: string };

export type LocalCandidatePatch = {
  id: string;
  currentDesignation?: string | null;
  currentOrganization?: string | null;
};

export async function updateLocalCandidate(patch: LocalCandidatePatch): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!patch.id) return { ok: false, error: "Missing candidate id." };

  const data: Record<string, string | null> = {};
  if ("currentDesignation" in patch) {
    data.currentDesignation = patch.currentDesignation?.trim() || null;
  }
  if ("currentOrganization" in patch) {
    data.currentOrganization = patch.currentOrganization?.trim() || null;
  }
  if (Object.keys(data).length === 0) return { ok: true };

  try {
    await prisma.candidate.update({
      where: { id: patch.id },
      data,
    });
    revalidatePath(`/candidates/${patch.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }
}
