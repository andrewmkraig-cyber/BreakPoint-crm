import type { Job } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Row shape for the /jobs list and the /jobs/new dropdown flavors that
// want native Neon columns (not the RF-shaped payload). `slug` is the
// stable URL segment — legacyRfId-as-string for RF-imported rows
// (back-compat with existing URLs) or the cuid for Ace-native rows.
export type JobListRow = {
  id: string;
  legacyRfId: number | null;
  slug: string;
  title: string;
  isOpen: boolean;
  clientId: string | null;
  clientLegacyRfId: number | null;
  clientName: string;
  locations: string[];
  updatedAt: string;
};

function slugFor(row: { id: string; legacyRfId: number | null }): string {
  return row.legacyRfId != null ? String(row.legacyRfId) : row.id;
}

// Lists every Job in the signed-in tenant. Both RF-imported (legacyRfId
// set) and Ace-native (legacyRfId null) rows come back. Consumers render
// from the native columns; the `raw` RFJob payload is not returned here
// — callers that still need the RF shape use getRfJobsForOrg in
// src/lib/candidates.ts, which surfaces the same rows in the legacy shape.
export async function getJobsForOrg(): Promise<JobListRow[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.job.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      legacyRfId: true,
      title: true,
      isOpen: true,
      locations: true,
      updatedAt: true,
      client: { select: { id: true, legacyRfId: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    legacyRfId: r.legacyRfId,
    slug: slugFor({ id: r.id, legacyRfId: r.legacyRfId }),
    title: r.title || "(untitled)",
    isOpen: r.isOpen,
    clientId: r.client?.id ?? null,
    clientLegacyRfId: r.client?.legacyRfId ?? null,
    clientName: r.client?.name ?? "",
    locations: Array.isArray(r.locations) ? r.locations : [],
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// Resolves a /jobs/[id] URL segment to a Job row. Accepts either a cuid
// (Ace-native, post-cutover canonical) or a numeric legacyRfId (back-compat
// with URLs that predate Phase 2). Scoped by the caller's tenant so cross-
// org lookups return null.
export async function getJobByIdentifier(raw: string): Promise<Job | null> {
  const org = await getCurrentOrg();
  if (/^-?\d+$/.test(raw)) {
    const legacyRfId = Number(raw);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.job.findFirst({ where: { legacyRfId, organizationId: org.id } });
  }
  return prisma.job.findFirst({ where: { id: raw, organizationId: org.id } });
}
