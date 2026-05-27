// Pure, framework-agnostic helpers for the dashboard period selector.
// Lives in its own (non-"use client") file so server components — page
// routes, scoreboard-data.ts, financial-performance-tab.tsx — can call
// them at render time. The "use client" PeriodTabs component imports
// from here too, so types and option labels stay in lockstep.
//
// The bucketing math (start/end of each period) lives in
// `@/lib/period-utils` — that module is shared with the invoice +
// placements-dashboard libraries so all four surfaces agree on what
// "Q2 2026" means. We re-export DashboardPeriod here so existing
// `from "@/app/dashboard/period-tabs-shared"` imports keep compiling.

export type { DashboardPeriod } from "@/lib/period-utils";
import type { DashboardPeriod } from "@/lib/period-utils";

export const DASHBOARD_PERIOD_ITEMS: ReadonlyArray<{
  id: DashboardPeriod;
  label: string;
}> = [
  { id: "YTD", label: "YTD" },
  { id: "THIS_QUARTER", label: "This Quarter" },
  { id: "LAST_QUARTER", label: "Last Quarter" },
  { id: "NEXT_QUARTER", label: "Next Quarter" },
];

export function resolveDashboardPeriod(
  raw: string | undefined | null,
): DashboardPeriod {
  if (raw === "YTD" || raw === "LAST_QUARTER" || raw === "NEXT_QUARTER") return raw;
  return "THIS_QUARTER";
}
