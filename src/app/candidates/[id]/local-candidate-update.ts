"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Local-only candidate field updates. RF candidates have a separate path
// in actions.ts (updateCandidate) that hits the RF API; this one writes
// to local Postgres only and is used by the Ace-local profile to fix up
// fields the resume parser missed and to edit identity fields inline
// from the consolidated identity card.

type Result = { ok: true } | { ok: false; error: string };

export type LocalCandidatePatch = {
  id: string;
  // Identity / employment
  firstName?: string | null;
  lastName?: string | null;
  currentDesignation?: string | null;
  currentOrganization?: string | null;
  // Contact
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinProfile?: string | null;
};

export async function updateLocalCandidate(patch: LocalCandidatePatch): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!patch.id) return { ok: false, error: "Missing candidate id." };

  // Build the update body lazily so unset fields stay untouched. trim()
  // every string field; collapse empties to null so the column actually
  // clears when the recruiter erases a value (instead of writing the
  // empty string and leaving "—" rendering as a stray space).
  const data: Record<string, string | null> = {};
  if ("firstName" in patch) {
    data.firstName = patch.firstName?.trim() || "";
    // firstName is required on the schema; refuse a clear that would
    // wipe the only required identity field.
    if (!data.firstName) return { ok: false, error: "First name is required." };
  }
  if ("lastName" in patch) {
    data.lastName = patch.lastName?.trim() || null;
  }
  if ("currentDesignation" in patch) {
    data.currentDesignation = patch.currentDesignation?.trim() || null;
  }
  if ("currentOrganization" in patch) {
    data.currentOrganization = patch.currentOrganization?.trim() || null;
  }
  if ("email" in patch) {
    data.email = patch.email?.trim() || null;
  }
  if ("phone" in patch) {
    data.phone = patch.phone?.trim() || null;
  }
  if ("location" in patch) {
    data.location = patch.location?.trim() || null;
  }
  if ("linkedinProfile" in patch) {
    data.linkedinProfile = patch.linkedinProfile?.trim() || null;
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
