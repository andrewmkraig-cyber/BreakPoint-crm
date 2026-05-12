import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { LaunchView, type VerticalOption, type SavedSearchOption, type LastRun } from "./launch-view";

export const dynamic = "force-dynamic";

// Default daily contact cap when neither the SavedSearch nor a future
// org-level Setting overrides it. Mirrors the workflow note in the BD
// handoff: ~80 contacts/day across 5 domains rotating ~16 each.
const DEFAULT_DAILY_CONTACT_CAP = 80;

// Phase 1: BD Settings page doesn't exist yet, so the pause-all toggle
// is hardcoded off. Lifts out to a Setting row when /settings/bd ships.
const PAUSE_ALL = false;

export default async function LaunchPage() {
  const org = await getCurrentOrg();

  const [verticalRows, savedSearchRows, domains, lastRunRow, todaysRuns] = await Promise.all([
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
    // Today's completed runs — used to compute daily contact usage
    // against the cap. Phase 1: metrics is always null because nothing
    // actually completes a run yet, so the sum is 0 and the launch
    // button never trips the cap-hit branch.
    prisma.bDRun.findMany({
      where: {
        organizationId: org.id,
        createdAt: { gte: startOfTodayUtc() },
        status: "COMPLETE",
      },
      select: { metrics: true },
    }),
  ]);

  const verticals: VerticalOption[] = verticalRows.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
  }));

  const savedSearches: SavedSearchOption[] = savedSearchRows.map((s) => ({
    id: s.id,
    verticalId: s.verticalId,
    name: s.name,
    contactCap: s.contactCap ?? DEFAULT_DAILY_CONTACT_CAP,
  }));

  const contactsUsedToday = todaysRuns.reduce((sum, r) => {
    const c = (r.metrics as { contacts?: unknown } | null)?.contacts;
    return sum + (typeof c === "number" ? c : 0);
  }, 0);

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
    <LaunchView
      verticals={verticals}
      savedSearches={savedSearches}
      domains={domains.map((d) => ({ domain: d.domain, status: d.status }))}
      lastRun={lastRun}
      defaultContactCap={DEFAULT_DAILY_CONTACT_CAP}
      contactsUsedToday={contactsUsedToday}
      pauseAll={PAUSE_ALL}
    />
  );
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
