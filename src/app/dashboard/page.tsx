import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardTabs, resolveDashboardTab } from "@/app/dashboard/tabs";
import { MyDashboard } from "@/app/dashboard/my-dashboard";
import { Scoreboard } from "@/app/dashboard/scoreboard";
import { PlacementsTab, resolvePlacementsPeriod } from "@/app/dashboard/placements-tab";

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
  const period = resolvePlacementsPeriod(firstParam(resolved.period));

  return (
    <div className="flex w-full flex-col gap-6">
      <DashboardTabs active={active} />
      {active === "dashboard" && <MyDashboard />}
      {active === "scoreboard" && <Scoreboard />}
      {active === "placements" && <PlacementsTab period={period} />}
    </div>
  );
}
