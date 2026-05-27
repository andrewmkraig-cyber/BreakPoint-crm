"use client";

import { useState, useTransition } from "react";

import {
  getBillingTowerData,
  type BillingTowerData,
  type BillingTowerPeriod,
} from "@/app/dashboard/billing-tower-actions";
import { cn } from "@/lib/utils";

// Billing Tower summary strip. One big-panel card with a header row
// ("Billing Tower" eyebrow + period selector) and a 3-column metrics
// row underneath: Revenue / Outstanding / Goal Progress.
//
// Period selector drives a server-action refetch — picking Next
// Quarter pulls Q3's revenue + outstanding + goal progress through the
// shared billing-events helper, not a client-side filter on whatever
// data was sent at first paint. Initial values arrive as props so the
// first render is server-rendered (no client fetch waterfall) and only
// the dropdown changes trigger an action.
//
// Semantics (matching getBillingTowerData / getBillingSummaryForRange):
//   Revenue     — every event scheduledAt in the selected period.
//                 "Booked placement revenue" — paid + unpaid both
//                 count. Q2 with a paid $7,500 + Ethan's unpaid
//                 $3,750 inst1 reads $11,250.
//   Outstanding — the unpaid subset of Revenue. Period-bounded, so
//                 selecting Next Quarter shows the next-quarter
//                 outstanding only.
//   Goal        — % of revenue against the period's dollar target.
//                 Quarters: $125K. YTD: $125K × quarters-in-progress.

export function FinancialStrip({
  initial,
  currentQuarterLabel,
}: {
  initial: BillingTowerData;
  currentQuarterLabel: string;
}) {
  const [period, setPeriod] = useState<BillingTowerPeriod>("current");
  const [data, setData] = useState<BillingTowerData>(initial);
  const [pending, startTransition] = useTransition();

  const clampedPct = Math.max(0, Math.min(100, data.goalPct));
  const revenueMeta =
    data.revenueCount > 0
      ? `${data.revenueCount} placement${data.revenueCount === 1 ? "" : "s"}`
      : "No placements yet";
  const outstandingMeta =
    data.outstandingCount > 0
      ? `${data.outstandingCount} open invoice${data.outstandingCount === 1 ? "" : "s"}`
      : "No open invoices";
  const remainingUsd = Math.max(0, data.goalUsd - data.revenueUsd);

  function onPeriodChange(next: BillingTowerPeriod) {
    setPeriod(next);
    // Server action returns the full Billing Tower payload for the
    // selected window — Revenue, Outstanding, Goal, label. useTransition
    // keeps the previous tile values visible (with opacity-60) while
    // the fetch is in flight so the UI doesn't blink to zeros.
    startTransition(async () => {
      const fresh = await getBillingTowerData(next);
      setData(fresh);
    });
  }

  return (
    <section className="rounded-3xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
          Billing Tower
        </div>
        <select
          aria-label="Billing Tower period"
          value={period}
          onChange={(e) => onPeriodChange(e.target.value as BillingTowerPeriod)}
          disabled={pending}
          className="rounded-lg border border-court-border bg-court-surface px-2 py-0.5 text-[11px] text-court-fg-muted transition hover:text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/40 disabled:opacity-60"
        >
          <option value="current">{`Current Quarter (${currentQuarterLabel})`}</option>
          <option value="next">Next Quarter</option>
          <option value="previous">Previous Quarter</option>
          <option value="ytd">Annual / YTD</option>
        </select>
      </div>
      <div
        className={cn(
          "mt-2.5 grid grid-cols-1 items-center gap-5 transition-opacity sm:grid-cols-[1fr_1fr_1.6fr] sm:gap-7",
          pending && "opacity-60",
        )}
      >
        <Stat
          label="Revenue"
          value={formatCompactUsd(data.revenueUsd)}
          meta={revenueMeta}
        />
        <Stat
          label="Outstanding"
          value={formatCompactUsd(data.outstandingUsd)}
          meta={outstandingMeta}
          dim={data.outstandingUsd === 0}
          divider
        />
        <GoalStat
          goalUsd={data.goalUsd}
          pct={clampedPct}
          remainingUsd={remainingUsd}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  meta,
  dim,
  divider,
}: {
  label: string;
  value: string;
  meta: string;
  dim?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        divider && "sm:border-l-2 sm:border-court-border-soft sm:pl-5",
      )}
    >
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-serif text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums",
          dim ? "text-court-fg-dim" : "text-court-fg",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-court-fg-dim">{meta}</div>
    </div>
  );
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
      <div className="mt-0.5 flex items-baseline gap-2.5 font-serif text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums text-court-fg">
        {Math.round(pct)}%
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

// Compact USD with up-to-2-decimal precision so 3,750 renders $3.75K
// instead of rounding to $3.8K (the old toFixed(1) behavior). Trailing
// zeros are stripped so $4,000 stays $4K, not $4.00K. Decimal cap is
// 2 places — Billing Tower numbers are always whole dollars, so 2dp
// is enough to express any K-ratio exactly (e.g. 3,750 → 3.75).
function formatCompactUsd(amount: number): string {
  if (amount === 0) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${stripTrailingZeros((amount / 1_000_000).toFixed(2))}M`;
  }
  if (abs >= 1_000) {
    return `$${stripTrailingZeros((amount / 1_000).toFixed(2))}K`;
  }
  return `$${Math.round(amount)}`;
}

function stripTrailingZeros(numStr: string): string {
  // "3.75" → "3.75", "4.00" → "4", "3.30" → "3.3"
  if (!numStr.includes(".")) return numStr;
  return numStr.replace(/\.?0+$/, "");
}

function formatGoalUsd(amount: number): string {
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : stripTrailingZeros(k.toFixed(2))}K`;
  }
  return `$${amount.toLocaleString("en-US")}`;
}
