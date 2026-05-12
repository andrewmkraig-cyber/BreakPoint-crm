import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardTabs, resolveDashboardTab } from "@/app/dashboard/tabs";
import { MyDashboard } from "@/app/dashboard/my-dashboard";
import { Scoreboard } from "@/app/dashboard/scoreboard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string | string[] }> | { tab?: string | string[] };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // Session resolved here for auth-gating elsewhere.
  await getServerSession(authOptions);

  const resolved = (await Promise.resolve(searchParams ?? {})) as { tab?: string | string[] };
  const rawTab = Array.isArray(resolved.tab) ? resolved.tab[0] : resolved.tab;
  const active = resolveDashboardTab(rawTab);

  return (
    <div className="flex w-full flex-col gap-6">
      <DashboardTabs active={active} />
      {active === "dashboard" && <MyDashboard />}
      {active === "scoreboard" && <Scoreboard />}
    </div>
  );
}
