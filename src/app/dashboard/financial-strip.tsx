"use client";

import { useState } from "react";

import {
  PlacementDrilldownDialog,
  type DrilldownQuery,
} from "@/components/dashboard/placement-drilldown-dialog";

// Billing Tower summary strip. One big-panel card with a header row
// ("Billing Tower" eyebrow + period selector) and a 4-column metrics
// row underneath. Billed and Collected preserve the click-to-drilldown
// behavior the previous Billing Tower had. The period selector is UI
// only for now — the metrics always show the current quarter; selecting
// a different option keeps the dropdown state but does not refetch.
type PeriodKey = "current" | "previous" | "ytd";

export function FinancialStrip({
  billedThisQuarterUsd,
  cashCollectedUsd,
  outstandingUsd,
  goalUsd,
  goalPct,
  currentQuarterLabel,
}: {
  billedThisQuarterUsd: number;
  cashCollectedUsd: number;
  outstandingUsd: number;
  goalUsd: number;
  goalPct: number;
  currentQuarterLabel: string;
}) {
  const [drilldown, setDrilldown] = useState<{
    query: DrilldownQuery;
    title: string;
  } | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("current");
  const clampedPct = Math.max(0, Math.min(100, goalPct));

  const labelCls =
    "text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted";
  const valueCls =
    "mt-1 font-serif font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg";
  const interactiveCls =
    "rounded-lg text-left transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-court-brand/40";

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Billing Tower
        </div>
        <select
          aria-label="Billing Tower period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          className="rounded-lg border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg-muted transition hover:text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/40"
        >
          <option value="current">{`Current Quarter (${currentQuarterLabel})`}</option>
          <option value="previous">Previous Quarter</option>
          <option value="ytd">Annual / YTD</option>
        </select>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
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
          <div className={labelCls}>Billed</div>
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
          <div className={labelCls}>Collected</div>
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
          <div className={labelCls}>Goal Progress</div>
          <div className={valueCls} style={{ fontSize: "22px" }}>
            {`${Math.round(clampedPct)}% to ${formatGoalUsd(goalUsd)}`}
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
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${amount.toLocaleString("en-US")}`;
}
