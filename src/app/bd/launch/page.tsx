import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { formatEasternWeekRange, getEasternWeekBounds } from "@/lib/week";
import {
  dedupeDiscoveredByCompany,
  recoverCompanyName,
} from "@/lib/bd/discovered-company";
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

const CLIENT_SUFFIX_PATTERNS = [
  /\s*&\s*associates\b/i,
  /\bp\s*l\s*l\s*c\b\.?/i,
  /\bllp\b\.?/i,
  /\bllc\b\.?/i,
  /\binc\b\.?/i,
  /\bpc\b\.?/i,
  /\bco\b\.?/i,
];

function normalizeCompanyName(name: string): string {
  let value = name.toLowerCase().trim();
  for (const pattern of CLIENT_SUFFIX_PATTERNS) {
    value = value.replace(pattern, "");
  }
  return value.replace(/[.,]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function payloadJobCount(payload: unknown): number {
  if (!Array.isArray(payload)) return 0;
  return payload.reduce((count, item) => {
    if (!item || typeof item !== "object") return count;
    const companyName = recoverCompanyName(item as Record<string, unknown>);
    return companyName ? count + 1 : count;
  }, 0);
}

function collectCompanyKeys(
  payloads: unknown[],
): { names: Set<string>; domains: Set<string> } {
  const names = new Set<string>();
  const domains = new Set<string>();
  for (const payload of payloads) {
    for (const company of dedupeDiscoveredByCompany(payload)) {
      const name = normalizeCompanyName(company.companyName);
      const domain = normalizeDomain(company.domain);
      if (name) names.add(name);
      if (domain) domains.add(domain);
    }
  }
  return { names, domains };
}

function matchesBdCompany(
  client: { name: string; domain: string | null },
  bdCompanies: { names: Set<string>; domains: Set<string> },
): boolean {
  const domain = normalizeDomain(client.domain);
  if (domain && bdCompanies.domains.has(domain)) return true;

  const name = normalizeCompanyName(client.name);
  if (!name) return false;
  for (const bdName of Array.from(bdCompanies.names)) {
    if (name === bdName || name.includes(bdName) || bdName.includes(name)) {
      return true;
    }
  }
  return false;
}

export default async function LaunchPage() {
  const org = await getCurrentOrg();

  // KPI window: current America/New_York week. This resets at the end of
  // Sunday night (effectively Monday 00:00:00 ET), matching "Sunday
  // 11:59 PM Eastern" from the BD dashboard brief.
  const week = getEasternWeekBounds();

  const [
    verticalRows,
    savedSearchRows,
    domains,
    orgConfig,
    pendingRuns,
    weeklyRuns,
    bdCompanySourceRuns,
    weeklyClients,
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
    // /settings/bd writes here. globalDailyCap is the fallback when
    // neither SavedSearch.contactCap nor the legacy
    // DEFAULT_DAILY_CONTACT_CAP applies.
    prisma.bdOrgConfig.findUnique({ where: { organizationId: org.id } }),
    getPendingBDRuns(),
    prisma.bDRun.findMany({
      where: {
        organizationId: org.id,
        createdAt: { gte: week.start, lt: week.end },
      },
      select: { discoveredPayload: true },
    }),
    prisma.bDRun.findMany({
      where: { organizationId: org.id },
      select: { discoveredPayload: true },
    }),
    prisma.client.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { createdAt: { gte: week.start, lt: week.end } },
          { addedAt: { gte: week.start, lt: week.end } },
        ],
      },
      select: { id: true, name: true, domain: true },
    }),
  ]);
  const orgDailyCap = orgConfig?.globalDailyCap ?? DEFAULT_DAILY_CONTACT_CAP;
  const weeklyPayloads = weeklyRuns.map((run) => run.discoveredPayload);
  const weeklyCompanies = collectCompanyKeys(weeklyPayloads);
  const bdCompanies = collectCompanyKeys(
    bdCompanySourceRuns.map((run) => run.discoveredPayload),
  );
  const newClientsFromBd = weeklyClients.filter((client) =>
    matchesBdCompany(client, bdCompanies),
  ).length;

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
    companiesIdentified: weeklyCompanies.names.size,
    jobsIdentified: weeklyPayloads.reduce<number>(
      (sum, payload) => sum + payloadJobCount(payload),
      0,
    ),
    newClientsFromBd,
    weekLabel: formatEasternWeekRange(week.start, week.end),
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
