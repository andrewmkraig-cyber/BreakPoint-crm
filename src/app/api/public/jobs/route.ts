import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { publicJobSlug } from "@/lib/public-job-slug";

export const dynamic = "force-dynamic";

const DEFAULT_PUBLIC_JOBS_OWNER_EMAIL = "andrew@breakpointtalent.com";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET() {
  const organizationId = process.env.DEFAULT_ORG_ID?.trim();
  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: "Public jobs feed is not configured." },
      { status: 503 },
    );
  }

  const ownerEmail =
    process.env.PUBLIC_JOBS_OWNER_EMAIL?.trim().toLowerCase() ||
    DEFAULT_PUBLIC_JOBS_OWNER_EMAIL;

  const owner = await prisma.user.findFirst({
    where: {
      email: { equals: ownerEmail, mode: "insensitive" },
      memberships: { some: { organizationId } },
    },
    select: { id: true },
  });

  if (!owner) {
    return NextResponse.json(
      { ok: false, error: "Public jobs owner is not configured." },
      { status: 503 },
    );
  }

  // This intentionally mirrors /jobs?owner=mine&tab=active. The lifecycle
  // alone is not sufficient: legacy/unclaimed Client rows can still have
  // isOpen=true, but they do not belong in Andrew's My Jobs list or on the
  // public BreakPoint Talent site.
  const rows = await prisma.job.findMany({
    where: {
      organizationId,
      lifecycle: "active",
      isOpen: true,
      publishToWebsite: true,
      client: { is: { ownerId: owner.id } },
    },
    orderBy: [
      { websitePriority: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
      { title: "asc" },
    ],
    select: {
      id: true,
      title: true,
      description: true,
      raw: true,
      locations: true,
      locationCity: true,
      locationState: true,
      locationZip: true,
      employmentType: true,
      workplaceType: true,
      hybridSchedule: true,
      salaryRangeStart: true,
      salaryRangeEnd: true,
      salaryCurrency: true,
      salaryFrequency: true,
      applyLink: true,
      createdAt: true,
      createdAtRf: true,
      updatedAt: true,
      websitePublishedAt: true,
      websitePriority: true,
      override: { select: { description: true } },
    },
  });

  const jobs = rows.flatMap((row) => {
    const raw = row.raw && typeof row.raw === "object"
      ? (row.raw as Record<string, unknown>)
      : {};
    const description =
      readString(row.override?.description) ??
      readString(row.description) ??
      readString(raw.description);
    const applyUrl = readString(row.applyLink) ?? readString(raw.apply_link);

    // A stale publish flag must never leak an incomplete job to Google.
    // The Website tab prevents this state, and this feed enforces it again.
    if (
      !description ||
      !row.locationCity ||
      !row.locationState ||
      !row.employmentType ||
      !row.workplaceType ||
      (row.workplaceType === "Hybrid" && !row.hybridSchedule)
    ) return [];

    return [{
      id: row.id,
      slug: publicJobSlug(row),
      title: row.title,
      description,
      locations: row.locations,
      location: {
        city: row.locationCity,
        state: row.locationState,
        postalCode: row.locationZip,
        country: "US",
      },
      employmentType: row.employmentType,
      workplaceType: row.workplaceType,
      hybridSchedule: row.hybridSchedule,
      salary: {
        minimum: row.salaryRangeStart,
        maximum: row.salaryRangeEnd,
        currency: row.salaryCurrency,
        frequency: row.salaryFrequency,
      },
      applyUrl,
      datePosted: (row.websitePublishedAt ?? row.createdAtRf ?? row.createdAt).toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      priority: row.websitePriority,
      eligibleForJobPosting: true,
    }];
  });

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      count: jobs.length,
      jobs,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
