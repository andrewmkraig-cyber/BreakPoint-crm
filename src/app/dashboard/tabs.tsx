import { TabStrip } from "@/components/ui/tab-strip";

export type DashboardTab = "dashboard" | "scoreboard";

export const DASHBOARD_TAB_LABELS: Record<DashboardTab, string> = {
  dashboard: "Dashboard",
  scoreboard: "Scoreboard",
};

const TAB_ORDER: DashboardTab[] = ["dashboard", "scoreboard"];

export function resolveDashboardTab(raw: string | undefined | null): DashboardTab {
  if (raw === "scoreboard") return raw;
  return "dashboard";
}

type Props = {
  active: DashboardTab;
  counts?: Partial<Record<DashboardTab, number>>;
};

export function DashboardTabs({ active, counts }: Props) {
  return (
    <TabStrip<DashboardTab>
      ariaLabel="Dashboard sections"
      activeId={active}
      items={TAB_ORDER.map((tab) => ({
        id: tab,
        label: DASHBOARD_TAB_LABELS[tab],
        count: counts?.[tab],
        href: tab === "dashboard" ? "/dashboard" : `/dashboard?tab=${tab}`,
      }))}
    />
  );
}
