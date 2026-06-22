"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { logActivity } from "@/lib/activity";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { triggerJobsSiteRebuild } from "@/lib/jobs-site-rebuild";
import { normalizeOwnerJobPriorities } from "@/lib/job-priority";
import { isHybridSchedule } from "@/lib/hybrid-schedule";
import { isLikelyZip, validateUsCity, validateUsZip } from "@/lib/location-validation";
import { prisma } from "@/lib/prisma";

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
  // Job title. Required (non-empty) when present; trimmed + length-capped.
  // The Overview edit form always sends the current title so a save can
  // rename the job.
  title?: string | null;
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
  // way in. An empty array clears the field. Legacy free-form path; the
  // Overview edit form now sends the structured trio below instead and
  // the action composes `locations` from them.
  locations?: string[];
  // Structured location. When any of these is present the action treats
  // location as the required City / State (2-letter) / Zip (5-digit)
  // trio, validates it, writes all three columns, and composes the
  // legacy `locations` array from them so downstream readers stay in
  // sync. Enforced on every edit-save (see updateJobOverview).
  locationCity?: string;
  locationState?: string;
  locationZip?: string;
  numberOfOpenings?: number | null;
  isOpen?: boolean;
  employmentType?: string | null;
  workplaceType?: string | null;
  hybridSchedule?: string | null;
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
    // Rule 8: tenant-scope the lookup so a leaked id from another org
    // can't be edited here. The page already loads this job org-scoped,
    // so adding the org filter is a no-op for the legitimate caller.
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: {
        ...(jobCuid ? { id: jobCuid } : { legacyRfId: jobRfId! }),
        organizationId: org.id,
      },
      select: {
        id: true,
        legacyRfId: true,
        lifecycle: true,
        isOpen: true,
        clientId: true,
        workplaceType: true,
      },
    });
    if (!job) return { ok: false, error: "Job not found." };

    const data: Prisma.JobUpdateInput = {};

    // Job title. The edit form always sends the current title, so a save
    // can rename the job. Required + trimmed + capped; Job.title is read
    // by the page header, the /jobs list, /pipeline, and the client jobs
    // table, all revalidated below when the title is part of the patch.
    if (patch.title !== undefined) {
      const t = (patch.title ?? "").trim();
      if (!t) return { ok: false, error: "Job title is required." };
      if (t.length > 300) return { ok: false, error: "Job title is too long." };
      data.title = t;
    }

    // Structured location. The Overview edit form sends City / State /
    // Zip and they are REQUIRED on every save (enforce-on-edit). Same
    // rule + validators as the New Job create path — no second
    // validator. Compose the legacy `locations` array from the trio so
    // the read-only Location cell + distance sub-line (which reads the
    // structured columns) stay in sync. Existing loose-location jobs
    // surface empty fields until the recruiter edits; once they save,
    // they must provide a valid trio.
    if (
      patch.locationCity !== undefined ||
      patch.locationState !== undefined ||
      patch.locationZip !== undefined
    ) {
      const city = (patch.locationCity ?? "").trim();
      const state = (patch.locationState ?? "").trim().toUpperCase();
      const zip = (patch.locationZip ?? "").trim();
      if (!city) return { ok: false, error: "City is required." };
      if (!state) return { ok: false, error: "State is required." };
      if (!/^[A-Z]{2}$/.test(state)) {
        return { ok: false, error: "State must be a 2-letter abbreviation." };
      }
      if (!zip) return { ok: false, error: "Zip is required." };
      if (!/^\d{5}$/.test(zip)) {
        return { ok: false, error: "Zip must be a 5-digit US zip code." };
      }
      const cityCheck = await validateUsCity(city);
      if (!cityCheck.ok) return { ok: false, error: `City: ${cityCheck.message}` };
      const zipCheck = await validateUsZip(zip);
      if (!zipCheck.ok) return { ok: false, error: `Zip: ${zipCheck.message}` };
      data.locationCity = city;
      data.locationState = state;
      data.locationZip = zip;
      const composed = [[city, state].filter(Boolean).join(", "), zip]
        .filter(Boolean)
        .join(" ")
        .trim();
      data.locations = composed ? [composed] : [];
    }
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
      if (!patch.isOpen) data.publishToWebsite = false;
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
    if (patch.workplaceType !== undefined) {
      const workplace = (patch.workplaceType ?? "").trim();
      if (workplace && !["On-site", "Hybrid", "Remote"].includes(workplace)) {
        return { ok: false, error: "Workplace must be On-site, Hybrid, or Remote." };
      }
      data.workplaceType = workplace || null;
    }
    if (patch.hybridSchedule !== undefined || patch.workplaceType !== undefined) {
      const workplace = (patch.workplaceType ?? job.workplaceType ?? "").trim();
      const schedule = (patch.hybridSchedule ?? "").trim();
      if (workplace === "Hybrid" && (!schedule || !isHybridSchedule(schedule))) {
        return { ok: false, error: "Choose a valid Days in office option for Hybrid work." };
      }
      data.hybridSchedule = workplace === "Hybrid" ? schedule : null;
    }

    await prisma.job.update({ where: { id: job.id }, data });

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    // A renamed title also shows on the /jobs list, /pipeline, and the
    // client's jobs table — refresh those when the title was edited.
    if (patch.title !== undefined) {
      revalidatePath(`/jobs`);
      revalidatePath(`/pipeline`);
      if (job.clientId) revalidatePath(`/clients/${job.clientId}`);
    }
    await triggerJobsSiteRebuild("job-overview-updated");
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
      select: {
        id: true,
        legacyRfId: true,
        title: true,
        lifecycle: true,
        isOpen: true,
        client: { select: { ownerId: true } },
      },
    });
    if (!job) return { ok: false, error: "Job not found." };

    const previous = (job.lifecycle as JobLifecycle | null) ?? (job.isOpen ? "active" : "inactive");
    if (previous === next) {
      return { ok: false, error: `Job is already ${next}.` };
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        lifecycle: next,
        isOpen: next !== "inactive",
        ...(next === "active"
          ? {}
          : { publishToWebsite: false, websitePriority: null }),
      },
    });
    if (job.client?.ownerId) {
      await normalizeOwnerJobPriorities(org.id, job.client.ownerId);
    }
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
    await triggerJobsSiteRebuild(`job-lifecycle-${next}`);
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

// Duplicate an existing job into a brand-new Ace-native row for the SAME
// client. Built for the common case of one client with the same opening
// in two cities (e.g. two Tax Managers, different metros): clone, then
// change the city on the copy. The copy carries over every job-definition
// field (title, comp, JD, keywords, etc.) but starts fresh as an active,
// Ace-native job - legacyRfId stays null (a duplicate is never a legacy
// import) and lifecycle resets to "active" so it lands on the /jobs Active
// tab regardless of the source's state. Pipeline / interviews / matches /
// board statuses are NOT copied; they belong to the original. Returns the
// new job's cuid so the caller can route straight to it for the city edit.
export async function duplicateJob(args: {
  jobId: string;
}): Promise<Result & { jobCuid?: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const org = await getCurrentOrg();
    // Rule 8: tenant-scope the source lookup so a leaked id from another
    // org can't be cloned here. Select only the job-definition columns we
    // carry over - relations and per-row state (placements, matches,
    // savedSearchFilters, lastOpenedAt, the legacy raw blob) are left out.
    const source = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: {
        title: true,
        clientId: true,
        locations: true,
        locationCity: true,
        locationState: true,
        locationZip: true,
        jobType: true,
        employmentType: true,
        workplaceType: true,
        hybridSchedule: true,
        department: true,
        salaryRangeStart: true,
        salaryRangeEnd: true,
        salaryCurrency: true,
        salaryFrequency: true,
        expectedFee: true,
        billRate: true,
        payRate: true,
        numberOfOpenings: true,
        hiringTeam: true,
        applyLink: true,
        description: true,
        sourceJobUrl: true,
        rawJobDescription: true,
        descriptionGeneratedAt: true,
        internalRecruiterNotes: true,
        searchKeywords: true,
      },
    });
    if (!source) return { ok: false, error: "Job not found." };

    const copy = await prisma.job.create({
      data: {
        title: source.title,
        clientId: source.clientId,
        locations: source.locations,
        locationCity: source.locationCity,
        locationState: source.locationState,
        locationZip: source.locationZip,
        // Fresh Ace-native job: never a legacy import, always starts active.
        isOpen: true,
        lifecycle: "active",
        jobType: source.jobType ?? Prisma.DbNull,
        employmentType: source.employmentType,
        workplaceType: source.workplaceType,
        hybridSchedule: source.hybridSchedule,
        department: source.department,
        salaryRangeStart: source.salaryRangeStart,
        salaryRangeEnd: source.salaryRangeEnd,
        salaryCurrency: source.salaryCurrency,
        salaryFrequency: source.salaryFrequency,
        expectedFee: source.expectedFee ?? Prisma.DbNull,
        billRate: source.billRate ?? Prisma.DbNull,
        payRate: source.payRate ?? Prisma.DbNull,
        numberOfOpenings: source.numberOfOpenings,
        hiringTeam: source.hiringTeam ?? Prisma.DbNull,
        applyLink: source.applyLink,
        description: source.description,
        sourceJobUrl: source.sourceJobUrl,
        rawJobDescription: source.rawJobDescription,
        descriptionGeneratedAt: source.descriptionGeneratedAt,
        internalRecruiterNotes: source.internalRecruiterNotes,
        searchKeywords: source.searchKeywords,
        organizationId: org.id,
      },
      select: { id: true },
    });

    await logActivity({
      organizationId: org.id,
      userId,
      actionType: "job_duplicated",
      targetType: "job",
      targetId: copy.id,
      metadata: { jobTitle: source.title, sourceJobId: args.jobId, clientId: source.clientId },
    });

    revalidatePath(`/jobs`);
    revalidatePath(`/jobs/${copy.id}`);
    if (source.clientId) {
      revalidatePath(`/clients`);
      revalidatePath(`/clients/${source.clientId}`);
    }
    await triggerJobsSiteRebuild("job-duplicated");
    return { ok: true, jobCuid: copy.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Duplicate failed." };
  }
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
    await triggerJobsSiteRebuild("job-deleted");
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

    if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
    revalidatePath(`/jobs/${job.id}`);
    await triggerJobsSiteRebuild("job-description-updated");
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
