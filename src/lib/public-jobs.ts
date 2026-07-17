import { prisma } from "@/lib/prisma";
import { normalizePublicJobDescription } from "@/lib/public-job-description";
import { publicJobSlug } from "@/lib/public-job-slug";

const DEFAULT_PUBLIC_JOBS_OWNER_EMAIL = "andrew@breakpointtalent.com";

export const PUBLIC_JOBS_SITE_ORIGIN = "https://breakpointtalent.com";

export type PublicWebsiteJob = {
  id: string;
  slug: string;
  title: string;
  description: string;
  company: string;
  locations: string[];
  location: {
    city: string;
    state: string;
    postalCode: string | null;
    country: "US";
  };
  employmentType: string;
  workplaceType: string;
  hybridSchedule: string | null;
  salary: {
    minimum: number | null;
    maximum: number | null;
    currency: string | null;
    frequency: string | null;
  };
  applyUrl: string | null;
  datePosted: string;
  updatedAt: string;
  priority: number | null;
  eligibleForJobPosting: true;
};

export type PublicJobsResult =
  | { ok: true; jobs: PublicWebsiteJob[] }
  | { ok: false; error: string };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// The website JSON feed and every external board feed call this helper so
// their definition of "published" cannot drift apart over time.
export async function getPublishedWebsiteJobs(): Promise<PublicJobsResult> {
  const organizationId = process.env.DEFAULT_ORG_ID?.trim();
  if (!organizationId) {
    return { ok: false, error: "Public jobs feed is not configured." };
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
    return { ok: false, error: "Public jobs owner is not configured." };
  }

  // This intentionally mirrors /jobs?owner=mine&tab=active. The lifecycle
  // alone is not sufficient: legacy/unclaimed Client rows can still have
  // isOpen=true, but they do not belong on the public BreakPoint Talent site.
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
      client: { select: { name: true } },
      override: { select: { description: true } },
    },
  });

  const jobs = rows.flatMap<PublicWebsiteJob>((row) => {
    const raw = row.raw && typeof row.raw === "object"
      ? (row.raw as Record<string, unknown>)
      : {};
    const description =
      readString(row.override?.description) ??
      readString(row.description) ??
      readString(raw.description);
    const applyUrl = readString(row.applyLink) ?? readString(raw.apply_link);

    // Publishing prevents this state, but keep the public read defensive in
    // case an old import or manual DB edit left a stale publish flag behind.
    if (
      !description ||
      !row.client?.name ||
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
      description: normalizePublicJobDescription(description),
      company: row.client.name,
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

  return { ok: true, jobs };
}
