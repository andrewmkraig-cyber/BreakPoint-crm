"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { triggerJobsSiteRebuild } from "@/lib/jobs-site-rebuild";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function setJobWebsitePublished(args: {
  jobId: string;
  published: boolean;
}): Promise<Result> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  try {
    const org = await getCurrentOrg();
    const job = await prisma.job.findFirst({
      where: { id: args.jobId, organizationId: org.id },
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
        publishToWebsite: true,
        client: { select: { ownerId: true } },
        override: { select: { description: true } },
      },
    });
    if (!job) return { ok: false, error: "Job not found." };

    if (args.published) {
      const raw = job.raw && typeof job.raw === "object"
        ? (job.raw as Record<string, unknown>)
        : {};
      const description =
        readString(job.override?.description) ??
        readString(job.description) ??
        readString(raw.description);

      if (job.client?.ownerId !== userId) {
        return { ok: false, error: "Only jobs in My Jobs can be published." };
      }
      if (job.lifecycle !== "active" || !job.isOpen) {
        return { ok: false, error: "Only Active jobs can be published." };
      }
      if (!description) {
        return { ok: false, error: "Add a complete job description before publishing." };
      }
      if (!job.locationCity || !job.locationState) {
        return { ok: false, error: "Add a structured city and state before publishing." };
      }
      if (!job.employmentType) {
        return { ok: false, error: "Add an employment type before publishing." };
      }
      if (!job.workplaceType) {
        return { ok: false, error: "Choose On-site, Hybrid, or Remote before publishing." };
      }
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        publishToWebsite: args.published,
        websitePublishedAt:
          args.published && !job.publishToWebsite ? new Date() : undefined,
      },
    });

    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/jobs");
    await triggerJobsSiteRebuild(
      args.published ? "job-published-to-website" : "job-removed-from-website",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Website publishing failed.",
    };
  }
}
