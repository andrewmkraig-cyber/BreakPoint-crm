// Pure, framework-agnostic helpers for the dashboard period selector.
// Lives in its own (non-"use client") file so server components — page
// routes, scoreboard-data.ts, financial-performance-tab.tsx — can call
// them at render time. The "use client" PeriodTabs component imports
// from here too, so types and option labels stay in lockstep.

export type DashboardPeriod =
  | "YTD"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "NEXT_QUARTER";

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

// Period bounds in local time. `endExclusive` is the half-open right edge.
export function dashboardPeriodRange(
  period: DashboardPeriod,
  now: Date = new Date(),
): { start: Date; endExclusive: Date; label: string } {
  const year = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3);
  if (period === "YTD") {
    return {
      start: new Date(year, 0, 1),
      endExclusive: new Date(year + 1, 0, 1),
      label: `YTD ${year}`,
    };
  }
  if (period === "LAST_QUARTER") {
    const startMonth = currentQuarter * 3 - 3;
    const startYear = startMonth < 0 ? year - 1 : year;
    const m = ((startMonth % 12) + 12) % 12;
    return {
      start: new Date(startYear, m, 1),
      endExclusive: new Date(startYear, m + 3, 1),
      label: `Q${Math.floor(m / 3) + 1} ${startYear}`,
    };
  }
  if (period === "NEXT_QUARTER") {
    const startMonth = currentQuarter * 3 + 3;
    const startYear = startMonth >= 12 ? year + 1 : year;
    const m = startMonth % 12;
    return {
      start: new Date(startYear, m, 1),
      endExclusive: new Date(startYear, m + 3, 1),
      label: `Q${Math.floor(m / 3) + 1} ${startYear}`,
    };
  }
  const startMonth = currentQuarter * 3;
  return {
    start: new Date(year, startMonth, 1),
    endExclusive: new Date(year, startMonth + 3, 1),
    label: `Q${currentQuarter + 1} ${year}`,
  };
}
