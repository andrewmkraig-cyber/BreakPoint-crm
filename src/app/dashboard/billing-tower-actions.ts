"use server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getBillingSummaryForRange } from "@/lib/billing-events";
import { periodRange } from "@/lib/period-utils";

// Billing Tower period taxonomy. Stays in step with the dropdown
// options in financial-strip.tsx — adding a new option here means
// adding the matching <option> there. Maps onto lib/period-utils
// DashboardPeriod so we share the same Q-bucketing math the
// scoreboard uses (no separate "what does Q2 mean?" definitions).
export type BillingTowerPeriod = "current" | "next" | "previous" | "ytd";

export type BillingTowerData = {
  revenueUsd: number;
  revenueCount: number;
  outstandingUsd: number;
  outstandingCount: number;
  goalUsd: number;
  goalPct: number;
  // Plain-English label of the selected window. "Q3 2026" / "YTD 2026".
  periodLabel: string;
};

// Per-quarter dollar goal. The number lived inline in my-dashboard.tsx
// as Q2_GOAL_USD = 125_000; extracted here so any other surface that
// wants "what's the quarter target?" reads one constant.
const QUARTER_GOAL_USD = 125_000;

// Cumulative goal for the selected window. Quarter windows always
// target one quarter ($125K). YTD scales by the number of quarters
// touched so far this year (in Q2, YTD goal = 2 × $125K = $250K) —
// otherwise % goal progress would always read low in Q1 / high in Q4.
function goalUsdForPeriod(period: BillingTowerPeriod, now: Date): number {
  if (period === "ytd") {
    const quartersInProgress = Math.floor(now.getMonth() / 3) + 1;
    return QUARTER_GOAL_USD * quartersInProgress;
  }
  return QUARTER_GOAL_USD;
}

function dashboardPeriodFor(period: BillingTowerPeriod) {
  if (period === "next") return "NEXT_QUARTER" as const;
  if (period === "previous") return "LAST_QUARTER" as const;
  if (period === "ytd") return "YTD" as const;
  return "THIS_QUARTER" as const;
}

// Compute the full Billing Tower payload for a period — Revenue,
// Outstanding, Goal Progress + label. Used both by the initial render
// (my-dashboard.tsx passes the current-quarter payload down) and the
// dropdown-driven refetch (financial-strip.tsx calls this server
// action when the user picks a different period).
export async function getBillingTowerData(
  period: BillingTowerPeriod,
): Promise<BillingTowerData> {
  const org = await getCurrentOrg();
  const now = new Date();
  const range = periodRange(dashboardPeriodFor(period), now);
  const summary = await getBillingSummaryForRange(
    org.id,
    range.start,
    range.endExclusive,
    prisma,
  );
  const revenueUsd = summary.revenueCents / 100;
  const goalUsd = goalUsdForPeriod(period, now);
  const goalPct = goalUsd > 0 ? (revenueUsd / goalUsd) * 100 : 0;
  return {
    revenueUsd,
    revenueCount: summary.revenueCount,
    outstandingUsd: summary.outstandingCents / 100,
    outstandingCount: summary.outstandingCount,
    goalUsd,
    goalPct,
    periodLabel: range.label,
  };
}
