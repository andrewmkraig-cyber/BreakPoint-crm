"use server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getBillingSummaryForRange } from "@/lib/billing-events";
import { timeRange, type TimeRangeSelection } from "@/lib/time-range";

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
// target one quarter ($125K). YTD (year / "this") scales by the number
// of quarters touched so far this year (in Q2, YTD goal = 2 × $125K =
// $250K) so % goal progress doesn't always read low in Q1 / high in Q4.
// The Billing Tower dropdown only ever surfaces quarter + YTD windows.
function goalUsdForSelection(sel: TimeRangeSelection, now: Date): number {
  if (sel.grain === "YEAR") {
    const quarters =
      sel.offset === 0 ? Math.floor(now.getMonth() / 3) + 1 : 4;
    return QUARTER_GOAL_USD * quarters;
  }
  return QUARTER_GOAL_USD;
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
  const goalUsd = goalUsdForSelection(selection, now);
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
