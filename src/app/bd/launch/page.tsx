import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getEasternDayStart } from "@/lib/week";
import { getPendingBDRuns } from "./bd-run-actions";
import {
  LaunchView,
  type VerticalOption,
  type SavedSearchOption,
  type BatchKpis,
} from "./launch-view";

export const dynamic = "force-dynamic";

// Default daily contact cap when neither the SavedSearch nor BdOrgConfig
// overrides it. Mirrors the workflow note in the BD handoff: ~80
// contacts/day across 5 domains rotating ~16 each.
const DEFAULT_DAILY_CONTACT_CAP = 80;

export default async function LaunchPage() {
  const org = await getCurrentOrg();

  // KPI window: ET midnight today onward, so the "today" tiles flip at
  // Eastern midnight rather than the server's UTC day.
  const todayStart = getEasternDayStart();

  const [
    verticalRows,
    savedSearchRows,
    domains,
    lastRunRow,
    orgConfig,
    pendingRuns,
    discoveredTodayCount,
    enrolledTodayCount,
    lastCompletedRun,
  ] = await Promise.all([
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
      select: { status: true },
    }),
    // /settings/bd writes here. globalDailyCap is the fallback when
    // neither SavedSearch.contactCap nor the legacy
    // DEFAULT_DAILY_CONTACT_CAP applies.
    prisma.bdOrgConfig.findUnique({ where: { organizationId: org.id } }),
    getPendingBDRuns(),
    // Discovered today: TheirStack-sourced runs created since ET midnight.
    prisma.bDRun.count({
      where: {
        organizationId: org.id,
        createdAt: { gte: todayStart },
        discoveryProvider: { contains: "theirstack" },
      },
    }),
    // Enrolled today: runs that reached APPROVED/COMPLETE today (by
    // approval or completion timestamp, whichever crossed today).
    prisma.bDRun.count({
      where: {
        organizationId: org.id,
        status: { in: ["APPROVED", "COMPLETE"] },
        OR: [
          { approvedAt: { gte: todayStart } },
          { completedAt: { gte: todayStart } },
        ],
      },
    }),
    // Last run: most recent BDRun that actually finished, for the relative
    // "Last Run" tile time.
    prisma.bDRun.findFirst({
      where: { organizationId: org.id, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
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

  const kpis: BatchKpis = {
    discoveredToday: discoveredTodayCount,
    enrolledToday: enrolledTodayCount,
    lastRunCompletedAt: lastCompletedRun?.completedAt?.toISOString() ?? null,
    lastRunStatus: lastRunRow?.status ?? null,
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <LaunchView
        verticals={verticals}
        savedSearches={savedSearches}
        domains={domains.map((d) => ({ domain: d.domain, status: d.status }))}
        defaultContactCap={orgDailyCap}
        initialRuns={pendingRuns}
        kpis={kpis}
      />
    </div>
  );
}
