"use server";

import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Save the per-job Matches-tab filter snapshot to Job.savedSearchFilters.
// One snapshot per job — overwrites whatever was there. Shape is whatever
// the client sends (the matches-tab.tsx Filters object); the loader on
// the read side coerces each field defensively so a stale save can't
// crash the surface.
type Result = { ok: true } | { ok: false; error: string };

export async function saveJobSearchFilters(
  jobId: string,
  filters: Record<string, unknown>,
): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const org = await getCurrentOrg();

  // Tenant scope check — confirm the job belongs to this org before the
  // update. Without this a forged jobId could overwrite another tenant's
  // saved search.
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    select: { id: true },
  });
  if (!job) return { ok: false, error: "Job not found." };

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { savedSearchFilters: filters as Prisma.InputJsonValue },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save search.",
    };
  }
}
