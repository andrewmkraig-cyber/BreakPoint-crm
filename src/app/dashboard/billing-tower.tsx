"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const PERIODS = [
  { value: "quarter-current", label: "Current Quarter (Q2 2026)" },
  { value: "quarter-previous", label: "Previous Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "since-inception", label: "Since Inception (May 1, 2026)" },
  { value: "custom", label: "Custom range…" },
] as const;

// `q2BilledRevenueUsd` is the sum of Placement.feeTotal across rows whose
// expectedStartDate lands in Apr 1 – Jul 1 2026 (pending_start + hired only),
// computed server-side. We wire it only for the default "Current Quarter"
// option today; the other period choices will need their own server-side
// aggregates when those views are real. Cash Collected stays at $0 until we
// have an invoice-paid signal.
export function BillingTower({ q2BilledRevenueUsd }: { q2BilledRevenueUsd: number }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("quarter-current");

  const billedLabel =
    period === "quarter-current" ? "Q2 Billed Revenue" : "Placement Revenue";
  const billedValue = period === "quarter-current" ? formatCompactUsd(q2BilledRevenueUsd) : "$0";
  const billedHint =
    period === "quarter-current"
      ? "Sum of fees on placements with a start date in Apr 1 – Jun 30 2026 (Pending Start + Hired)."
      : "Fees earned on placements that hit start date.";

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
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label={billedLabel} value={billedValue} hint={billedHint} tone="accent" />
        <Metric
          label="Cash Collected"
          value="$0"
          hint="Client payments received, regardless of placement date. Stays at $0 until invoices are paid."
          tone="neutral"
        />
      </div>
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
