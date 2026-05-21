export type DashboardTab = "dashboard" | "scoreboard" | "placements";

// Display labels for each dashboard view. The section nav itself lives in
// the left sidebar (Clubhouse / Metrics / Placements); these labels are
// still used by the top bar to title the page for a given ?tab= value.
// The "scoreboard" key keeps its URL param but reads "Metrics" to match
// the sidebar's renamed entry.
export const DASHBOARD_TAB_LABELS: Record<DashboardTab, string> = {
  dashboard: "Clubhouse",
  scoreboard: "Metrics",
  placements: "Placements",
};

export function resolveDashboardTab(raw: string | undefined | null): DashboardTab {
  if (raw === "scoreboard") return raw;
  if (raw === "placements") return raw;
  return "dashboard";
}
