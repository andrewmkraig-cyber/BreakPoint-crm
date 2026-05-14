import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardTabs, resolveDashboardTab } from "@/app/dashboard/tabs";
import { MyDashboard } from "@/app/dashboard/my-dashboard";
import { Scoreboard } from "@/app/dashboard/scoreboard";
import { PlacementsTab, resolvePlacementsPeriod } from "@/app/dashboard/placements-tab";
import { resolveDashboardPeriod } from "@/app/dashboard/period-tabs-shared";

export const dynamic = "force-dynamic";

type RawParams = { tab?: string | string[]; period?: string | string[] };
type SearchParams = Promise<RawParams> | RawParams;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // Session resolved here for auth-gating elsewhere.
  await getServerSession(authOptions);

  const resolved = (await Promise.resolve(searchParams ?? {})) as RawParams;
  const active = resolveDashboardTab(firstParam(resolved.tab));
  const periodRaw = firstParam(resolved.period);
  const placementsPeriod = resolvePlacementsPeriod(periodRaw);
  const scoreboardPeriod = resolveDashboardPeriod(periodRaw);

  return (
    <div className="flex w-full flex-col gap-6">
      <DashboardTabs active={active} />
      {active === "dashboard" && <MyDashboard />}
      {active === "scoreboard" && <Scoreboard period={scoreboardPeriod} />}
      {active === "placements" && <PlacementsTab period={placementsPeriod} />}
    </div>
  );
}
