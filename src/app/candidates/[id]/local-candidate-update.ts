"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { coordinatePatchForCandidateLocationUpdate } from "@/lib/candidate-location-geocode";
import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/rf-payload-shapes";

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
  source?: string | null;
  // Skills - dedupe + trim is the caller's job; we just write the array.
  skills?: string[];
};

export async function updateLocalCandidate(patch: LocalCandidatePatch): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!patch.id) return { ok: false, error: "Missing candidate id." };

  // Build the update body lazily so unset fields stay untouched. trim()
  // every string field; collapse empties to null so the column actually
  // clears when the recruiter erases a value (instead of writing the
  // empty string and leaving "—" rendering as a stray space).
  // Skills is a Postgres String[] column so it lives in the same data
  // object but typed as string[] - prisma rejects mixing scalar + array
  // shapes if we narrow the type, so the data record stays loose.
  const data: Prisma.CandidateUpdateManyMutationInput = {};
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
    data.phone = normalizeToE164(patch.phone);
  }
  if ("location" in patch) {
    data.location = patch.location?.trim() || null;
  }
  if ("linkedinProfile" in patch) {
    data.linkedinProfile = patch.linkedinProfile?.trim() || null;
  }
  if ("source" in patch) {
    data.source = patch.source?.trim() || null;
  }
  if ("skills" in patch && Array.isArray(patch.skills)) {
    data.skills = patch.skills;
  }
  if (Object.keys(data).length === 0) return { ok: true };

  try {
    const org = await getCurrentOrg();

    if ("location" in patch) {
      const existing = await prisma.candidate.findFirst({
        where: { id: patch.id, organizationId: org.id },
        select: { location: true, lat: true, lng: true },
      });
      if (!existing) return { ok: false, error: "Candidate not found." };
      Object.assign(
        data,
        await coordinatePatchForCandidateLocationUpdate({
          nextLocation: data.location as string | null,
          previousLocation: existing.location,
          previousLat: existing.lat,
          previousLng: existing.lng,
        }),
      );
    }

    const result = await prisma.candidate.updateMany({
      where: { id: patch.id, organizationId: org.id },
      data,
    });
    if (result.count === 0) return { ok: false, error: "Candidate not found." };
    revalidatePath(`/candidates/${patch.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }
}
