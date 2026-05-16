"use client";

import { useState } from "react";

import {
  PlacementDrilldownDialog,
  type DrilldownQuery,
} from "@/components/dashboard/placement-drilldown-dialog";
import { cn } from "@/lib/utils";

// Billing Tower summary strip. One big-panel card with a header row
// ("Billing Tower" eyebrow + period selector) and a 3-column metrics
// row underneath: Revenue / Outstanding / Goal Progress. Billed and
// Collected used to be separate columns but always read identically in
// practice (one placement → one invoice → one PAID), so we fold them
// into a single Revenue column whose meta line carries "X placement ·
// Y% collected" so no information is lost. The Revenue column keeps
// the click-to-drilldown behavior the previous Billing Tower had.
type PeriodKey = "current" | "previous" | "ytd";

export function FinancialStrip({
  revenueUsd,
  revenueCount,
  outstandingUsd,
  outstandingCount,
  goalUsd,
  goalPct,
  currentQuarterLabel,
}: {
  // Revenue = PAID invoices this quarter + uninvoiced placements this
  // quarter (locked fee, no invoice attached). Read as "fees earned in
  // the current period" rather than "cash in hand." Goal Progress's
  // "to go" math reads off this same value so the three tiles stay
  // numerically consistent.
  revenueUsd: number;
  revenueCount: number;
  outstandingUsd: number;
  outstandingCount: number;
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

  const revenueMeta =
    revenueCount > 0
      ? `${revenueCount} placement${revenueCount === 1 ? "" : "s"}`
      : "No placements yet";
  // Outstanding now mixes SENT invoices and uninvoiced placements, so
  // "open invoices" is too narrow — drop to a generic "open" count.
  const outstandingMeta =
    outstandingCount > 0
      ? `${outstandingCount} open`
      : "No open billing";
  const remainingUsd = Math.max(0, goalUsd - revenueUsd);

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Billing Tower
        </div>
        <select
          aria-label="Billing Tower period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          className="rounded-lg border border-court-border bg-court-surface px-2 py-0.5 text-[11px] text-court-fg-muted transition hover:text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/40"
        >
          <option value="current">{`Current Quarter (${currentQuarterLabel})`}</option>
          <option value="previous">Previous Quarter</option>
          <option value="ytd">Annual / YTD</option>
        </select>
      </div>
      <div className="mt-2.5 grid grid-cols-1 items-center gap-5 sm:grid-cols-[1fr_1fr_1.6fr] sm:gap-7">
        <Stat
          label="Revenue"
          value={formatCompactUsd(revenueUsd)}
          meta={revenueMeta}
          onClick={() =>
            setDrilldown({
              query: { kind: "cash_collected" },
              title: "Collected This Quarter",
            })
          }
        />
        <Stat
          label="Outstanding"
          value={formatCompactUsd(outstandingUsd)}
          meta={outstandingMeta}
          dim={outstandingUsd === 0}
          divider
        />
        <GoalStat
          goalUsd={goalUsd}
          pct={clampedPct}
          remainingUsd={remainingUsd}
        />
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

function Stat({
  label,
  value,
  meta,
  dim,
  divider,
  onClick,
}: {
  label: string;
  value: string;
  meta: string;
  dim?: boolean;
  divider?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-serif text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums",
          dim ? "text-court-fg-dim" : "text-court-fg",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-court-fg-dim">{meta}</div>
    </>
  );
  const wrapCls = cn(
    "flex min-w-0 flex-col",
    divider && "sm:border-l-2 sm:border-court-border-soft sm:pl-5",
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          wrapCls,
          "rounded-lg text-left transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-court-brand/40",
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={wrapCls}>{inner}</div>;
}

function GoalStat({
  goalUsd,
  pct,
  remainingUsd,
}: {
  goalUsd: number;
  pct: number;
  remainingUsd: number;
}) {
  return (
    <div className="flex min-w-0 flex-col sm:border-l-2 sm:border-court-border-soft sm:pl-6">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-court-brand-dark">
        Goal Progress · {formatGoalUsd(goalUsd)} Quarter
      </div>
      <div className="mt-0.5 flex items-baseline gap-2.5 font-serif text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums text-court-fg">
        {pct}%
        <span className="text-[11.5px] font-semibold tracking-normal text-court-fg-muted">
          · {formatGoalUsd(remainingUsd)} to go
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, rgb(var(--court-brand) / 0.85), rgb(var(--court-brand)))",
            boxShadow: "0 0 8px rgb(var(--court-brand) / 0.4)",
          }}
        />
      </div>
    </div>
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
