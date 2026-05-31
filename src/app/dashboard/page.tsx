import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveDashboardTab } from "@/app/dashboard/tabs";
import { MyDashboard } from "@/app/dashboard/my-dashboard";
import { Scoreboard } from "@/app/dashboard/scoreboard";
import { PlacementsTab } from "@/app/dashboard/placements-tab";
import { resolveTimeRange } from "@/lib/time-range";
import { CLUBHOUSE_PERIOD_PARAM } from "@/app/dashboard/clubhouse-period";

export const dynamic = "force-dynamic";

type RawParams = {
  tab?: string | string[];
  period?: string | string[];
  [CLUBHOUSE_PERIOD_PARAM]?: string | string[];
};
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
  // Placements + Metrics share the ?period= param (only one view renders at a
  // time). Both default to the current quarter.
  const period = resolveTimeRange(periodRaw);
  // Clubhouse activity strip has its own param and defaults to the current week.
  const clubhousePeriod = resolveTimeRange(
    firstParam(resolved[CLUBHOUSE_PERIOD_PARAM]),
    { grain: "WEEK", period: "THIS" },
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section nav (Clubhouse / Metrics / Placements) lives in the left
          sidebar now, so no in-page tab strip here — each view owns its
          own header. The ?tab= param the sidebar links to still drives
          which view renders below. */}
      {active === "dashboard" && <MyDashboard selection={clubhousePeriod} />}
      {active === "scoreboard" && <Scoreboard selection={period} />}
      {active === "placements" && <PlacementsTab selection={period} />}
    </div>
  );
}
