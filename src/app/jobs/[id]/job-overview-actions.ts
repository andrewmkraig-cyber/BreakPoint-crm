"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { logActivity } from "@/lib/activity";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { isLikelyZip, validateUsCity, validateUsZip } from "@/lib/location-validation";
import { prisma } from "@/lib/prisma";
import { recomputeMatchesForJob } from "@/lib/match-scoring-store";

// Fire a deterministic match-score recompute across every stored
// CandidateMatch row for a job. Best-effort: never throws, never
// blocks the JD save. Used by the four JD-edit actions in this file
// (saveJobGeneratedDescription / saveJobSearchKeywords / saveJobRaw
// Description / updateJobOverview when salary / locations / employment
// type change) plus updateJobOverrideDescription in job-override-
// actions.ts. The deterministic scorer reads description + search
// Keywords + salaryRange + locations + employmentType — so every one
// of these surfaces a sourceHash flip on the next read.
async function recomputeMatchesAfterJobEdit(orgId: string, jobId: string, label: string): Promise<void> {
  try {
    const stats = await recomputeMatchesForJob(orgId, jobId);
    // eslint-disable-next-line no-console
    console.log(`[${label}] recomputed matches`, { jobId, ...stats });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[${label}] match recompute failed`, { jobId, err: e instanceof Error ? e.message : String(e) });
  }
}

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  if (s.user.id) return s.user.id;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true },
  });
  return u?.id ?? null;
}

// Inline-edit writes for the Overview sidebar on /jobs/[id]. Each
// optional field maps to its Job-table column. RF-imported and Ace-
// native rows take the same write path — Ace-native is the future
// canonical anyway, and the find-matches / Game Plan readers already
// pull from these columns directly, so updates surface there
// immediately. The sidebar component reads straight from the Job row
// on revalidate, so we don't have to keep Job.raw in sync for this
// view; the previous /jobs/[id] header read via normalizeJob(raw) was
// retired in the layout overhaul that introduced this action.

type Result = { ok: true } | { ok: false; error: string };

export type JobOverviewPatch = {
  // Compensation. Pass numbers (or null to clear). Currency is a 3-letter
  // ISO code; the form normalizes blank to USD. salaryFrequency is
  // "yearly" or "hourly" — drives the comp display ("$80k–$120k / yr"
  // vs "$25 – $35 / hr") and any downstream readers (Game Plan
  // context, find-matches scoring) that already consume the column.
  salaryRangeStart?: number | null;
  salaryRangeEnd?: number | null;
  salaryCurrency?: string | null;
  salaryFrequency?: string | null;
  // Comma-free single value — the form splits multiple locations on the
  // way in. An empty array clears the field.
  locations?: string[];
  numberOfOpenings?: number | null;
  isOpen?: boolean;
  employmentType?: string | null;
};

export async function updateJobOverview(args: {
  jobRfId?: number | null;
  jobCuid?: string | null;
  patch: JobOverviewPatch;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const { jobRfId, jobCuid, patch } = args;
  if (!jobCuid && jobRfId == null) {
    return { ok: false, error: "Job id invalid." };
  }

  // Validate salary inputs before hitting the DB so the user gets a
  // clean error string instead of a Prisma stack.
  const lo = patch.salaryRangeStart;
  const hi = patch.salaryRangeEnd;
  if (lo != null && lo < 0) return { ok: false, error: "Salary low can't be negative." };
  if (hi != null && hi < 0) return { ok: false, error: "Salary high can't be negative." };
  if (lo != null && hi != null && lo > hi) {
    return { ok: false, error: "Salary low can't be greater than salary high." };
  }
  const openings = patch.numberOfOpenings;
  if (openings != null && (openings < 0 || !Number.isInteger(openings))) {
    return { ok: false, error: "Openings must be a positive whole number." };
  }

  try {
    const job = await prisma.job.findFirst({
      where: jobCuid ? { id: jobCuid } : { legacyRfId: jobRfId! },
      select: { id: true, legacyRfId: true, lifecycle: true, isOpen: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    const data: Prisma.JobUpdateInput = {};
    if (patch.salaryRangeStart !== undefined) data.salaryRangeStart = patch.salaryRangeStart;
    if (patch.salaryRangeEnd !== undefined) data.salaryRangeEnd = patch.salaryRangeEnd;
    if (patch.salaryCurrency !== undefined) {
      const ccy = (patch.salaryCurrency ?? "").trim().toUpperCase().slice(0, 3);
      data.salaryCurrency = ccy || null;
    }
    if (patch.salaryFrequency !== undefined) {
      const freq = (patch.salaryFrequency ?? "").trim().toLowerCase();
      data.salaryFrequency = freq === "hourly" || freq === "yearly" ? freq : null;
    }
    if (patch.locations !== undefined) {
      const cleaned = patch.locations
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      // US location validation. The overview cell's free-form input
      // is split on commas before reaching us, so each entry is one
      // chunk like "Atlanta", "GA 30303", or "30303". We validate
      // each non-empty chunk as either a US ZIP (if it looks like
      // one) or as a US city. The validation helpers fail open on
      // network errors, so the recruiter isn't blocked by a Nominatim
      // outage. Same "blank passes" rule as the New Job form — an
      // empty `cleaned` array clears the field without checking.
      for (const chunk of cleaned) {
        // A 2-letter state abbreviation alone (e.g. "KY") is a
        // common shorthand for remote roles. Skip the network check
        // for those — they're not a city, but the field has always
        // allowed them. Anything longer than two letters goes
        // through the full validation pass.
        if (/^[A-Za-z]{2}$/.test(chunk)) continue;
        if (isLikelyZip(chunk)) {
          const zipCheck = await validateUsZip(chunk);
          if (!zipCheck.ok) {
            return { ok: false, error: `Location "${chunk}": ${zipCheck.message}` };
          }
          continue;
        }
        // Strip a trailing " ST" / " ST 12345" pattern so "Atlanta GA"
        // and "Atlanta GA 30303" both reduce to "Atlanta" for the
        // city probe. Conservative — only matches a clearly-state
        // shaped suffix.
        const cityPart = chunk.replace(/\s+[A-Za-z]{2}(\s+\d{5}(?:-\d{4})?)?$/, "").trim();
        const cityCheck = await validateUsCity(cityPart || chunk);
        if (!cityCheck.ok) {
          return { ok: false, error: `Location "${chunk}": ${cityCheck.message}` };
        }
      }
      data.locations = cleaned;
    }
    if (patch.numberOfOpenings !== undefined) data.numberOfOpenings = patch.numberOfOpenings;
    if (patch.isOpen !== undefined) {
      data.isOpen = patch.isOpen;
      // Keep lifecycle in sync when the right-rail Edit form toggles
      // isOpen. We don't want a stale "private" label sticking around
      // after the recruiter's flipped the status to inactive (or
      // re-opened a previously-inactive private job back to active).
      // Active / inactive is what the legacy toggle has always meant;
      // the recruiter who wants Private uses the dedicated button on
      // the Overview tab.
      if (patch.isOpen !== job.isOpen) {
        data.lifecycle = patch.isOpen ? "active" : "inactive";
      }
    }
    if (patch.employmentType !== undefined) {
      const et = (patch.employmentType ?? "").trim();
      data.employmentType = et || null;
    }

    await prisma.job.update({ where: { id: job.id }, data });

    // Salary range / locations / employment type all feed the
    // deterministic scorer's sourceHash. Recompute every stored
    // CandidateMatch row for the job so Find Matches reflects the
    // new inputs on next read. lifecycle / isOpen / openings don't
    // touch the score — but we recompute unconditionally because the
    // patch is mixed and the recompute is cheap.
    const org = await getCurrentOrg();
    await recomputeMatchesAfterJobEdit(org.id, job.id, "updateJobOverview");

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Three-state lifecycle transitions for the Overview tab. Each writes
// both `lifecycle` (canonical /jobs-tab signal) AND `isOpen` (legacy
// "this job is being worked" signal that 30+ readers — search_jobs,
// find-matches, pipeline, top-bar-search, etc. — already consume).
// Mapping: active/private → isOpen=true (still in the pipeline);
// inactive → isOpen=false (closed out). Activity rows land before
// each write so a future audit can trace the full lifecycle path.

export type JobLifecycle = "active" | "private" | "inactive";

async function transitionLifecycle(
  jobId: string,
  next: JobLifecycle,
  actionType: string,
): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true, title: true, lifecycle: true, isOpen: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    const previous = (job.lifecycle as JobLifecycle | null) ?? (job.isOpen ? "active" : "inactive");
    if (previous === next) {
      return { ok: false, error: `Job is already ${next}.` };
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { lifecycle: next, isOpen: next !== "inactive" },
    });
    await logActivity({
      organizationId: org.id,
      userId,
      actionType,
      targetType: "job",
      targetId: job.id,
      metadata: { jobTitle: job.title, fromLifecycle: previous, toLifecycle: next },
    });

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath(`/jobs`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function inactivateJob(args: { jobId: string }): Promise<Result> {
  return transitionLifecycle(args.jobId, "inactive", "job_inactivated");
}

export async function makeJobPrivate(args: { jobId: string }): Promise<Result> {
  return transitionLifecycle(args.jobId, "private", "job_made_private");
}

export async function reactivateJob(args: { jobId: string }): Promise<Result> {
  return transitionLifecycle(args.jobId, "active", "job_reactivated");
}

// Hard-delete a Job. Cascades through the Prisma schema take care of
// Placement / Interview / CandidateMatch / JobBoardStatus / JobOverride
// rows that point at this Job — every relation declares onDelete:
// Cascade. Org-scoped lookup so a leaked id from another tenant 404s
// instead of nuking the wrong row. Activity log lands BEFORE the
// delete so the audit row survives the cascade (ActivityLog has no FK
// to Job; targetId is a polymorphic string).
export async function deleteJob(args: { jobId: string }): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true, title: true, clientId: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "job_deleted",
      targetType: "job",
      targetId: job.id,
      metadata: {
        jobTitle: job.title,
        clientId: job.clientId,
        legacyRfId: job.legacyRfId,
      },
    });
    await prisma.job.delete({ where: { id: job.id } });

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath(`/jobs`);
    revalidatePath(`/pipeline`);
    if (job.clientId) revalidatePath(`/clients/${job.clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// Save a recruiter-edited Generated JD back onto Job.description. The
// Generated JD lives on Job.description (the generate-jd route writes
// there), so the Edit toggle on the JD tab persists straight to the
// same column. descriptionGeneratedAt is left alone — it tracks the
// last AI generation, not manual edits.
export async function saveJobGeneratedDescription(args: {
  jobId: string;
  description: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const next = args.description;
  if (next.length > 200_000) {
    return { ok: false, error: "Description too long." };
  }

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await prisma.job.update({
      where: { id: job.id },
      data: { description: next.trim() ? next : null },
    });

    // Description is the primary text input feeding the deterministic
    // skill / keyword pre-filter inside the scorer's sourceHash. Fan
    // out the recompute now so Find Matches + Matched tab reflect
    // the new description on next read.
    await recomputeMatchesAfterJobEdit(org.id, job.id, "saveJobGeneratedDescription");

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Save the recruiter-pasted source URL onto the Job. Tenant-scoped per
// CLAUDE.md rule #8 — the lookup filters on organizationId so a stale
// jobId from another tenant cannot land a write here. Successful saves
// also write an ActivityLog row so the URL surfaces in the job's
// activity feed without the recruiter having to open the JD tab.
export async function saveJobSourceUrl(args: {
  jobId: string;
  url: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email;
  if (!userEmail) return { ok: false, error: "Not signed in." };

  const trimmed = args.url.trim();
  if (trimmed.length > 2000) {
    return { ok: false, error: "URL too long." };
  }
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: "URL must start with http:// or https://." };
  }

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true, title: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await prisma.job.update({
      where: { id: job.id },
      data: { sourceJobUrl: trimmed || null },
    });

    // Skip the audit row when the field is being cleared — "saved an
    // empty URL" isn't a meaningful event and would clutter the feed.
    if (trimmed) {
      const userId =
        session.user.id ??
        (
          await prisma.user.findUnique({
            where: { email: userEmail },
            select: { id: true },
          })
        )?.id;
      if (userId) {
        await logActivity({
          organizationId: org.id,
          userId,
          actionType: "job_source_posting_saved",
          targetType: "job",
          targetId: job.id,
          metadata: { jobTitle: job.title, sourceUrl: trimmed },
        });
      }
    }

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Recruiter-only context kept alongside the candidate-facing description.
// Save-on-blur from the JD tab. Capped to the same 200k budget as the
// raw paste so a stray multi-MB clipboard dump doesn't land in the row.
export async function saveJobInternalRecruiterNotes(args: {
  jobId: string;
  notes: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const next = args.notes;
  if (next.length > 200_000) {
    return { ok: false, error: "Internal notes too long." };
  }

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await prisma.job.update({
      where: { id: job.id },
      data: { internalRecruiterNotes: next.trim() ? next : null },
    });

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Comma-separated keywords/skills the recruiter wants Find Matches +
// any Boolean candidate search to emphasize. Save-on-blur from the JD
// tab; tenant-scoped lookup per CLAUDE.md rule #8.
export async function saveJobSearchKeywords(args: {
  jobId: string;
  keywords: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const next = args.keywords;
  if (next.length > 10_000) {
    return { ok: false, error: "Keywords too long." };
  }

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await prisma.job.update({
      where: { id: job.id },
      data: { searchKeywords: next.trim() ? next.trim() : null },
    });

    // searchKeywords drives the "required" bucket in the deterministic
    // skill scorer. Editing it is the single highest-signal way the
    // recruiter retunes Find Matches for a role; recompute fan-out is
    // exactly what they expect to happen on save.
    await recomputeMatchesAfterJobEdit(org.id, job.id, "saveJobSearchKeywords");

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Save the recruiter's raw paste of the job description onto the Job.
// Lives next to (not on top of) the cleaned/edited description so the
// original copy stays intact for re-parsing later.
export async function saveJobRawDescription(args: {
  jobId: string;
  rawDescription: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const next = args.rawDescription;
  if (next.length > 200_000) {
    return { ok: false, error: "Raw description too long." };
  }

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!job) return { ok: false, error: "Job not found." };

    await prisma.job.update({
      where: { id: job.id },
      data: { rawJobDescription: next.trim() ? next : null },
    });

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
