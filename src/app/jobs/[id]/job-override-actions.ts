"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { recomputeMatchesForJob } from "@/lib/match-scoring-store";

// Local-only override layer for RF jobs. RF is the system of record but
// doesn't have a writeable description endpoint we can use, and the
// recruiter wants a place to author an Ace-friendly description that
// merge fields ([Job Description]) can read on interview invites and
// submittal emails. Override > RF when present.

type Result = { ok: true } | { ok: false; error: string };

// Unified job-description save. Two storage locations:
//   - RF-imported jobs (legacyRfId set) → JobOverride.description layered
//     over RF's raw.description. Preserves the pre-Phase-2 override UX.
//   - Ace-native jobs (legacyRfId null) → Job.description directly. The
//     JobOverride table keys on Int jobRfId (primary key), which Ace-
//     native rows don't have.
// Callers pass whichever identifier they have; the action resolves the
// Job row once and branches on legacyRfId.
export async function updateJobOverrideDescription(args: {
  jobRfId?: number | null;
  jobCuid?: string | null;
  description: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "User not found." };

  const rfId = args.jobRfId ?? null;
  const cuid = args.jobCuid ?? null;
  if (rfId == null && !cuid) return { ok: false, error: "Job id invalid." };

  const description = args.description.trim();
  try {
    // Resolve the Job row by whichever id we have so we can tell RF-
    // imported (legacyRfId set) from Ace-native (null).
    const job = await prisma.job.findFirst({
      where: cuid ? { id: cuid } : { legacyRfId: rfId! },
      select: { id: true, legacyRfId: true },
    });

    if (job && job.legacyRfId == null) {
      // Ace-native: write the description directly onto the Job row.
      await prisma.job.update({
        where: { id: job.id },
        data: { description: description || null },
      });
      // eslint-disable-next-line no-console
      console.log("[updateJobOverrideDescription] ace-native saved", {
        jobId: job.id,
        descLength: description.length,
      });
      // Description is part of the deterministic match-score sourceHash.
      // Fan out a recompute across every stored CandidateMatch row for
      // this job so Find Matches + the Matched tab reflect the new
      // description on next read. Best-effort.
      const org = await getCurrentOrg();
      try {
        const stats = await recomputeMatchesForJob(org.id, job.id);
        // eslint-disable-next-line no-console
        console.log("[updateJobOverrideDescription] recomputed matches", { jobId: job.id, ...stats });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[updateJobOverrideDescription] match recompute failed", { jobId: job.id, err: e instanceof Error ? e.message : String(e) });
      }
      revalidatePath(`/jobs/${job.id}`);
      revalidatePath("/candidates", "layout");
      return { ok: true };
    }

    // RF-imported: layer via JobOverride. Use the legacyRfId from the
    // resolved Job row when available (more trustworthy than whatever
    // the caller passed in).
    const resolvedRfId = job?.legacyRfId ?? rfId;
    if (resolvedRfId == null) return { ok: false, error: "Job id invalid." };
    const org = await getCurrentOrg();
    const saved = await prisma.jobOverride.upsert({
      where: { jobRfId: resolvedRfId },
      update: {
        description: description || null,
        updatedById: user.id,
      },
      create: {
        jobRfId: resolvedRfId,
        jobId: job?.id ?? null,
        description: description || null,
        updatedById: user.id,
        organizationId: org.id,
      },
      select: { jobRfId: true, description: true, updatedAt: true },
    });
    // eslint-disable-next-line no-console
    console.log("[updateJobOverrideDescription] upserted", {
      jobRfId: saved.jobRfId,
      descLength: saved.description?.length ?? 0,
      descPreview: saved.description?.slice(0, 200) ?? null,
      updatedAt: saved.updatedAt.toISOString(),
    });
    // RF-imported branch: JD content is sourced from Job.description /
    // raw.description / JobOverride.description per the readJobDescription
    // priority. The deterministic scorer reads Job.description directly,
    // so an override-only edit doesn't flip the sourceHash on its own.
    // We still force a recompute pass when the Job row is resolved so
    // recruiters see the new override land immediately in Find Matches.
    if (job?.id) {
      try {
        const stats = await recomputeMatchesForJob(org.id, job.id);
        // eslint-disable-next-line no-console
        console.log("[updateJobOverrideDescription] recomputed matches (rf branch)", { jobId: job.id, ...stats });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[updateJobOverrideDescription] rf-branch match recompute failed", { jobId: job.id, err: e instanceof Error ? e.message : String(e) });
      }
    }
    revalidatePath(`/jobs/${resolvedRfId}`);
    revalidatePath("/candidates", "layout");
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[updateJobOverrideDescription] save failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
