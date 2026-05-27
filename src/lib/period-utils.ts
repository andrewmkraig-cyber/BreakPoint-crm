// Shared quarter / period bucketing for the dashboard, billing tower,
// invoice summary, and placements dashboard. Replaces three near-
// identical copies that lived in:
//   - src/lib/invoices.ts               (quarterRange — current quarter)
//   - src/lib/placements-dashboard.ts   (periodRange — 4 periods, {start,end})
//   - src/app/dashboard/period-tabs-shared.ts (dashboardPeriodRange — 4 periods + label)
//
// All three used the same local-time `Math.floor(month / 3) * 3` math;
// this module preserves it verbatim and centralizes it so the four
// dashboards always agree on what "Q2 2026" means. The result shape
// standardizes on `endExclusive` (half-open right edge) because every
// downstream Prisma filter uses `lt:` rather than `lte:`.
//
// Pure module: no React, no DB, no env — safe for both server and
// client component imports. The UI-only helpers
// (DASHBOARD_PERIOD_ITEMS, resolveDashboardPeriod) stay in
// period-tabs-shared.ts since they're tied to the selector component.

export type DashboardPeriod =
  | "YTD"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "NEXT_QUARTER";

export type PeriodRange = {
  start: Date;
  endExclusive: Date;
  label: string;
};

export function periodRange(
  period: DashboardPeriod,
  now: Date = new Date(),
): PeriodRange {
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
