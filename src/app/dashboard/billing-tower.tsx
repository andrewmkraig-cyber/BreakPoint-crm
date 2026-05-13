"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// localStorage key for the collapse-state toggle. Per-card key matches
// the news-feed convention so each dashboard block remembers its own
// minimized/expanded state across reloads.
const COLLAPSE_KEY = "ace.dashboard.billing-tower.collapsed";

const PERIODS = [
  { value: "quarter-current", label: "Current Quarter (Q2 2026)" },
  { value: "quarter-previous", label: "Previous Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "since-inception", label: "Since Inception (April 1, 2026)" },
  { value: "custom", label: "Custom range…" },
] as const;

// `q2BilledRevenueUsd` is the sum of Placement.feeTotal across rows whose
// expectedStartDate lands in Apr 1 – Jul 1 2026 (pending_start + hired only),
// computed server-side. `cashCollectedQtdUsd` is the sum of Invoice.feeAmount
// where status=PAID and paidAt falls in the current quarter. Both are wired
// only for the default "Current Quarter" option today; the other period
// choices will need their own server-side aggregates when those views are real.
export function BillingTower({
  q2BilledRevenueUsd,
  cashCollectedQtdUsd,
}: {
  q2BilledRevenueUsd: number;
  cashCollectedQtdUsd: number;
}) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("quarter-current");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const billedLabel =
    period === "quarter-current" ? "Q2 Billed Revenue" : "Placement Revenue";
  const billedValue = period === "quarter-current" ? formatCompactUsd(q2BilledRevenueUsd) : "$0";
  const billedHint =
    period === "quarter-current"
      ? "Sum of fees on placements with a start date in Apr 1 - Jun 30 2026 (Pending Start + Hired)."
      : "Fees earned on placements that hit start date.";
  const collectedValue =
    period === "quarter-current" ? formatCompactUsd(cashCollectedQtdUsd) : "$0";
  const collectedHint =
    period === "quarter-current"
      ? "Sum of fees on invoices marked paid this quarter (Apr 1 - Jun 30 2026)."
      : "Client payments received in the selected window.";

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2
            className="font-semibold tracking-[-0.035em] text-court-fg"
            style={{ fontSize: "18px", lineHeight: 1.15 }}
          >
            Billing Tower
          </h2>
          <p
            className="mt-0.5 text-court-fg-muted"
            style={{ fontSize: "12px" }}
          >
            Revenue and collections overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="appearance-none rounded-lg border border-court-border bg-court-surface py-2 pl-3 pr-9 text-sm font-medium text-court-fg shadow-sm focus:border-court-accent focus:outline-none"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="billing-tower-body"
            aria-label={collapsed ? "Expand billing tower" : "Minimize billing tower"}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="billing-tower-body" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Metric label={billedLabel} value={billedValue} hint={billedHint} tone="accent" />
          <Metric
            label="Cash Collected"
            value={collectedValue}
            hint={collectedHint}
            tone="neutral"
          />
        </div>
      )}
    </section>
  );
}

// Compact USD: $7.5K for thousands, $1.2M for millions, $750 for sub-1K
// values. Stripping trailing ".0" so $7000 reads "$7K" instead of "$7.0K".
// Capital K matches the M case so the suffix reads consistently.
function formatCompactUsd(amount: number): string {
  if (amount === 0) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `$${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${amount}`;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "accent" | "neutral";
}) {
  // Headline metric (Q2 Billed Revenue) sits on a soft sage tint;
  // Cash Collected stays on white with a subtle inset border so the
  // pair reads as primary + secondary instead of two equal weights.
  const accent = tone === "accent";
  const wrapper = accent
    ? "rounded-2xl bg-court-accent-tint p-4"
    : "rounded-2xl bg-court-surface p-4 ring-1 ring-inset ring-court-border-soft";
  const labelCls =
    "text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted";
  const valueCls = accent
    ? "mt-2 font-serif font-extrabold leading-none tracking-[-0.05em] tabular-nums text-court-fg dark:text-court-accent-dark"
    : "mt-2 font-serif font-extrabold leading-none tracking-[-0.05em] tabular-nums text-court-fg";
  return (
    <div className={wrapper}>
      <div className={labelCls}>{label}</div>
      <div className={valueCls} style={{ fontSize: "32px" }}>
        {value}
      </div>
      <p className="mt-2 text-xs text-court-fg-muted">{hint}</p>
    </div>
  );
}
