"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { triggerJobsSiteRebuild } from "@/lib/jobs-site-rebuild";
import { normalizeOwnerJobPriorities } from "@/lib/job-priority";
import { prisma } from "@/lib/prisma";

export type JobsBulkAction = "activate" | "inactivate" | "publish" | "unpublish";

type Result =
  | { ok: true; updated: number }
  | { ok: false; error: string };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function runJobsBulkAction(args: {
  jobIds: string[];
  action: JobsBulkAction;
}): Promise<Result> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  const jobIds = Array.from(new Set(args.jobIds.filter(Boolean))).slice(0, 100);
  if (jobIds.length === 0) return { ok: false, error: "Select at least one job." };

  try {
    const org = await getCurrentOrg();
    const jobs = await prisma.job.findMany({
      where: { organizationId: org.id, id: { in: jobIds } },
      select: {
        id: true,
        title: true,
        lifecycle: true,
        isOpen: true,
        description: true,
        raw: true,
        locationCity: true,
        locationState: true,
        employmentType: true,
        workplaceType: true,
        hybridSchedule: true,
        publishToWebsite: true,
        client: { select: { ownerId: true } },
        override: { select: { description: true } },
      },
    });
    if (jobs.length !== jobIds.length) {
      return { ok: false, error: "One or more selected jobs are no longer available." };
    }

    if (args.action === "publish") {
      for (const job of jobs) {
        const raw = job.raw && typeof job.raw === "object"
          ? (job.raw as Record<string, unknown>)
          : {};
        const description =
          readString(job.override?.description) ??
          readString(job.description) ??
          readString(raw.description);
        const isRemote = job.workplaceType === "Remote";
        const missing = [
          job.client?.ownerId !== userId ? "My Jobs ownership" : null,
          job.lifecycle !== "active" || !job.isOpen ? "Active status" : null,
          !description ? "job description" : null,
          !isRemote && (!job.locationCity || !job.locationState) ? "city and state" : null,
          !job.employmentType ? "employment type" : null,
          !job.workplaceType ? "workplace type" : null,
          job.workplaceType === "Hybrid" && !job.hybridSchedule ? "days in office" : null,
        ].filter(Boolean);
        if (missing.length) {
          return {
            ok: false,
            error: `${job.title} cannot publish yet. Missing: ${missing.join(", ")}.`,
          };
        }
      }
    }

    const now = new Date();
    if (args.action === "activate") {
      await prisma.job.updateMany({
        where: { organizationId: org.id, id: { in: jobIds } },
        data: { lifecycle: "active", isOpen: true },
      });
    } else if (args.action === "inactivate") {
      await prisma.job.updateMany({
        where: { organizationId: org.id, id: { in: jobIds } },
        data: {
          lifecycle: "inactive",
          isOpen: false,
          publishToWebsite: false,
          websitePriority: null,
        },
      });
    } else if (args.action === "publish") {
      await Promise.all(
        jobs.map((job) =>
          prisma.job.update({
            where: { id: job.id },
            data: {
              publishToWebsite: true,
              websitePublishedAt: job.publishToWebsite ? undefined : now,
              websitePriority: job.publishToWebsite ? undefined : null,
            },
          }),
        ),
      );
    } else {
      await prisma.job.updateMany({
        where: { organizationId: org.id, id: { in: jobIds } },
        data: { publishToWebsite: false, websitePriority: null },
      });
    }

    const ownerIds = Array.from(
      new Set(jobs.map((job) => job.client?.ownerId).filter((id): id is string => Boolean(id))),
    );
    if (["activate", "inactivate", "publish", "unpublish"].includes(args.action)) {
      for (const ownerId of ownerIds) await normalizeOwnerJobPriorities(org.id, ownerId);
    }

    const actionType = `jobs_bulk_${args.action}`;
    await Promise.all(
      jobs.map((job) =>
        logActivity({
          organizationId: org.id,
          userId,
          actionType,
          targetType: "job",
          targetId: job.id,
          metadata: { jobTitle: job.title, bulkCount: jobs.length },
        }),
      ),
    );

    revalidatePath("/jobs");
    revalidatePath("/pipeline");
    for (const job of jobs) revalidatePath(`/jobs/${job.id}`);
    await triggerJobsSiteRebuild(`jobs-bulk-${args.action}`);
    return { ok: true, updated: jobs.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Bulk job update failed.",
    };
  }
}

export async function setJobWebsitePriority(args: {
  jobId: string;
  position: number;
}): Promise<Result> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
      select: {
        id: true,
        lifecycle: true,
        isOpen: true,
        publishToWebsite: true,
        client: { select: { ownerId: true } },
      },
    });
    if (!job) return { ok: false, error: "Job not found." };
    const ownerId = job.client?.ownerId;
    if (!ownerId || ownerId !== userId) {
      return { ok: false, error: "Only jobs in My Jobs can be reordered." };
    }
    if (job.lifecycle !== "active" || !job.isOpen) {
      return { ok: false, error: "Only Active jobs can be prioritized." };
    }
    if (!job.publishToWebsite) {
      return { ok: false, error: "Only jobs published on the website can be prioritized." };
    }

    const jobs = await prisma.job.findMany({
      where: {
        organizationId: org.id,
        lifecycle: "active",
        isOpen: true,
        publishToWebsite: true,
        client: { is: { ownerId } },
      },
      select: { id: true, websitePriority: true, updatedAt: true },
    });
    jobs.sort((a, b) => {
      const ap = a.websitePriority ?? Number.MAX_SAFE_INTEGER;
      const bp = b.websitePriority ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    const currentIndex = jobs.findIndex((row) => row.id === job.id);
    if (currentIndex < 0) return { ok: false, error: "Job is not in the Active list." };
    const [moving] = jobs.splice(currentIndex, 1);
    const target = Math.max(0, Math.min(jobs.length, Math.floor(args.position) - 1));
    jobs.splice(target, 0, moving);
    await prisma.$transaction(
      jobs.map((row, index) =>
        prisma.job.update({ where: { id: row.id }, data: { websitePriority: index + 1 } }),
      ),
    );

    revalidatePath("/jobs");
    await triggerJobsSiteRebuild("job-website-priority-updated");
    return { ok: true, updated: jobs.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Priority update failed.",
    };
  }
}
