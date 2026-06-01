import { FinancialPerformanceTab } from "@/app/dashboard/financial-performance-tab";

export const dynamic = "force-dynamic";

// Standalone Expenses page (Ops sidebar). Split out of the old combined
// /finances surface in Ace 74.0 alongside the standalone /invoices page;
// the Revenue & Profitability tab was deleted (its three Revenue cards
// moved to the Placements page). FinancialPerformanceTab now renders the
// Expenses section only: subscriptions, money in, tools, ROI, totals.
export default function ExpensesPage() {
  return (
    <div className="flex w-full flex-col gap-6">
      <FinancialPerformanceTab />
    </div>
  );
}
