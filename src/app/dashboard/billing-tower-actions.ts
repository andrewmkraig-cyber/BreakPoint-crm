"use server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  ANNUAL_REVENUE_GOAL_USD,
  QUARTERLY_REVENUE_GOAL_USD,
} from "@/app/dashboard/goal-pacing";
import { getBillingSummaryForRange } from "@/lib/billing-events";
import { timeRange, type TimeRangeSelection } from "@/lib/time-range";

export type BillingTowerData = {
  revenueUsd: number;
  revenueCount: number;
  outstandingUsd: number;
  outstandingCount: number;
  goalUsd: number;
  goalPct: number;
  goalPeriodLabel: string;
  // Plain-English label of the selected window. "Q3 2026" / "YTD 2026".
  periodLabel: string;
};

// Goal for the selected window. Quarter windows target one quarter. Annual
// / YTD shows revenue year-to-date, but progress is against the annual goal.
function goalForSelection(sel: TimeRangeSelection): {
  usd: number;
  periodLabel: string;
} {
  if (sel.grain === "YEAR") {
    return { usd: ANNUAL_REVENUE_GOAL_USD, periodLabel: "Annual Goal" };
  }
  return { usd: QUARTERLY_REVENUE_GOAL_USD, periodLabel: "Quarterly Goal" };
}

// Compute the full Billing Tower payload for a window — Revenue,
// Outstanding, Goal Progress + label. Used both by the initial render
// (my-dashboard.tsx passes the current-quarter payload down) and the
// dropdown-driven refetch (financial-strip.tsx calls this server
// action when the user picks a different window).
export async function getBillingTowerData(
  selection: TimeRangeSelection,
): Promise<BillingTowerData> {
  const org = await getCurrentOrg();
  const now = new Date();
  const range = timeRange(selection, now);
  const summary = await getBillingSummaryForRange(
    org.id,
    range.start,
    range.endExclusive,
    prisma,
  );
  const revenueUsd = summary.revenueCents / 100;
  const goal = goalForSelection(selection);
  const goalUsd = goal.usd;
  const goalPct = goalUsd > 0 ? (revenueUsd / goalUsd) * 100 : 0;
  return {
    revenueUsd,
    revenueCount: summary.revenueCount,
    outstandingUsd: summary.outstandingCents / 100,
    outstandingCount: summary.outstandingCount,
    goalUsd,
    goalPct,
    goalPeriodLabel: goal.periodLabel,
    periodLabel: range.label,
  };
}
