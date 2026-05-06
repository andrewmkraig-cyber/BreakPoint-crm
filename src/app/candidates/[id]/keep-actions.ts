"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { createActionLog } from "@/lib/action-log";
import { prisma } from "@/lib/prisma";

// Candidate-level Keep — flips the "kept" tag on the Candidate.tags
// column. Distinct from the per-placement keepCandidate in
// placement-actions.ts: that one writes a Placement row at stage "kept"
// against a specific job, this one is a recruiter shortlist signal that
// applies to the candidate as a whole and surfaces as the bookmark
// chip on the profile + the Kept tab in lists. No RF call (rule 1 + the
// no-RF-on-create rule extend to anything we're newly authoring in
// Ace).

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export async function toggleCandidateKept(input: {
  candidateId: string;
}): Promise<Result<{ isKept: boolean }>> {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email;
  if (!userEmail) return { ok: false, error: "Not signed in." };
  const userId = session.user.id
    ?? (await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } }))?.id;
  if (!userId) return { ok: false, error: "Could not resolve user id." };

  const org = await getCurrentOrg();

  const candidate = await prisma.candidate.findFirst({
    where: { id: input.candidateId, organizationId: org.id },
    select: { id: true, rfId: true, tags: true, raw: true },
  });
  if (!candidate) return { ok: false, error: "Candidate not found." };

  const existing = (candidate.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const hasKept = existing.some((t) => {
    const lower = t.toLowerCase();
    return lower === "kept" || lower === "keep";
  });
  const nextTags = hasKept
    ? existing.filter((t) => {
        const lower = t.toLowerCase();
        return lower !== "kept" && lower !== "keep";
      })
    : [...existing, "kept"];

  // Mirror the change into candidate.raw.tags too so the RF-shape
  // collectTags() helper on the profile picks it up for the chip
  // without an extra DB read. raw is a Json column — defensively
  // re-build the tags slot rather than mutating in place.
  const rawObj = (candidate.raw as Record<string, unknown> | null) ?? null;
  const rawTags = Array.isArray(rawObj?.tags) ? (rawObj!.tags as unknown[]) : [];
  const rawTagsNormalized = rawTags
    .map((t) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object" && typeof (t as { name?: string }).name === "string") {
        return (t as { name: string }).name;
      }
      return "";
    })
    .filter(Boolean);
  const rawHasKept = rawTagsNormalized.some((t) => {
    const lower = t.toLowerCase();
    return lower === "kept" || lower === "keep";
  });
  let nextRawTags: unknown[] | null = null;
  if (rawObj) {
    if (hasKept && rawHasKept) {
      nextRawTags = (rawTags as unknown[]).filter((t) => {
        const name =
          typeof t === "string"
            ? t
            : t && typeof t === "object" && typeof (t as { name?: string }).name === "string"
              ? (t as { name: string }).name
              : "";
        const lower = name.toLowerCase();
        return lower !== "kept" && lower !== "keep";
      });
    } else if (!hasKept && !rawHasKept) {
      nextRawTags = [...(rawTags as unknown[]), "kept"];
    }
  }

  try {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        tags: { set: nextTags },
        ...(nextRawTags
          ? { raw: { ...(rawObj ?? {}), tags: nextRawTags } as object }
          : {}),
      },
    });
    await createActionLog({
      userId,
      actionType: hasKept ? "unkeep_candidate" : "keep_candidate",
      subjectType: "candidate",
      subjectId: candidate.id,
      metadata: {},
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to toggle keep." };
  }

  // Revalidate both URL shapes so the indicator pill updates whether
  // the recruiter is on the cuid path or the legacy rfId path.
  revalidatePath(`/candidates/${candidate.id}`);
  if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);
  return { ok: true, value: { isKept: !hasKept } };
}
