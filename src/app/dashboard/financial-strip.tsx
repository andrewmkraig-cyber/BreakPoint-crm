"use client";

import { useState } from "react";

import {
  PlacementDrilldownDialog,
  type DrilldownQuery,
} from "@/components/dashboard/placement-drilldown-dialog";

// Compact 4-column financial summary that replaces the old Billing
// Tower + Q2/Annual revenue tiles. Same big-panel chrome as the rest
// of the dashboard (rounded-3xl, soft shadow). Billed and Cash Collected
// preserve the click-to-drilldown behavior the Billing Tower had.
export function FinancialStrip({
  billedThisQuarterUsd,
  cashCollectedUsd,
  outstandingUsd,
  goalUsd,
  goalPct,
}: {
  billedThisQuarterUsd: number;
  cashCollectedUsd: number;
  outstandingUsd: number;
  goalUsd: number;
  goalPct: number;
}) {
  const [drilldown, setDrilldown] = useState<{
    query: DrilldownQuery;
    title: string;
  } | null>(null);
  const clampedPct = Math.max(0, Math.min(100, goalPct));

  const labelCls =
    "text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted";
  const valueCls =
    "mt-1 font-serif font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg";
  const interactiveCls =
    "rounded-lg text-left transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-court-brand/40";

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <button
          type="button"
          onClick={() =>
            setDrilldown({
              query: { kind: "billed_revenue" },
              title: "Billed This Quarter",
            })
          }
          className={interactiveCls}
        >
          <div className={labelCls}>Billed This Quarter</div>
          <div className={valueCls} style={{ fontSize: "22px" }}>
            {formatCompactUsd(billedThisQuarterUsd)}
          </div>
        </button>
        <button
          type="button"
          onClick={() =>
            setDrilldown({
              query: { kind: "cash_collected" },
              title: "Cash Collected",
            })
          }
          className={interactiveCls}
        >
          <div className={labelCls}>Cash Collected</div>
          <div className={valueCls} style={{ fontSize: "22px" }}>
            {formatCompactUsd(cashCollectedUsd)}
          </div>
        </button>
        <div className="min-w-0">
          <div className={labelCls}>Outstanding</div>
          <div className={valueCls} style={{ fontSize: "22px" }}>
            {formatCompactUsd(outstandingUsd)}
          </div>
        </div>
        <div className="min-w-0">
          <div className={labelCls}>{`Progress to ${formatGoalUsd(goalUsd)} Goal`}</div>
          <div className={valueCls} style={{ fontSize: "22px" }}>
            {`${Math.round(clampedPct)}%`}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-court-surface-subtle">
            <div
              className="h-full rounded-full bg-court-brand transition-[width]"
              style={{ width: `${clampedPct}%` }}
            />
          </div>
        </div>
      </div>
      {drilldown && (
        <PlacementDrilldownDialog
          eyebrow="Financials"
          title={drilldown.title}
          query={drilldown.query}
          onClose={() => setDrilldown(null)}
        />
      )}
    </section>
  );
}

function formatCompactUsd(amount: number): string {
  if (amount === 0) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `$${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${Math.round(amount)}`;
}

function formatGoalUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
