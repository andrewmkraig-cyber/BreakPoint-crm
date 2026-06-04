import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getPendingBDRuns } from "./bd-run-actions";
import { LaunchView, type VerticalOption, type SavedSearchOption, type LastRun } from "./launch-view";

export const dynamic = "force-dynamic";

// Default daily contact cap when neither the SavedSearch nor BdOrgConfig
// overrides it. Mirrors the workflow note in the BD handoff: ~80
// contacts/day across 5 domains rotating ~16 each.
const DEFAULT_DAILY_CONTACT_CAP = 80;

export default async function LaunchPage() {
  const org = await getCurrentOrg();

  const [verticalRows, savedSearchRows, domains, lastRunRow, orgConfig, pendingRuns] = await Promise.all([
    prisma.vertical.findMany({
      where: { organizationId: org.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    prisma.savedSearch.findMany({
      where: { organizationId: org.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, verticalId: true, name: true, contactCap: true },
    }),
    prisma.sendingDomain.findMany({
      where: { organizationId: org.id },
      orderBy: [{ status: "asc" }, { lastUsedAt: "asc" }],
      take: 5,
      select: { domain: true, status: true },
    }),
    prisma.bDRun.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, metrics: true },
    }),
    // /settings/bd writes here. globalDailyCap is the fallback when
    // neither SavedSearch.contactCap nor the legacy
    // DEFAULT_DAILY_CONTACT_CAP applies.
    prisma.bdOrgConfig.findUnique({ where: { organizationId: org.id } }),
    getPendingBDRuns(),
  ]);
  const orgDailyCap = orgConfig?.globalDailyCap ?? DEFAULT_DAILY_CONTACT_CAP;

  const verticals: VerticalOption[] = verticalRows.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
  }));

  const savedSearches: SavedSearchOption[] = savedSearchRows.map((s) => ({
    id: s.id,
    verticalId: s.verticalId,
    name: s.name,
    contactCap: s.contactCap ?? orgDailyCap,
  }));

  const lastRun: LastRun | null = lastRunRow
    ? {
        id: lastRunRow.id,
        status: lastRunRow.status,
        createdAt: lastRunRow.createdAt.toISOString(),
        companies: ((lastRunRow.metrics as { companies?: unknown } | null)?.companies ?? null) as
          | number
          | null,
      }
    : null;

  return (
    <div className="flex w-full flex-col gap-6">
      <LaunchView
        verticals={verticals}
        savedSearches={savedSearches}
        domains={domains.map((d) => ({ domain: d.domain, status: d.status }))}
        lastRun={lastRun}
        defaultContactCap={orgDailyCap}
        initialRuns={pendingRuns}
      />
    </div>
  );
}
