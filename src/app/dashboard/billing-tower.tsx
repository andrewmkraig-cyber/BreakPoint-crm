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
  const activeLabel = PERIODS.find((p) => p.value === period)?.label ?? "";

  const billedLabel =
    period === "quarter-current" ? "Q2 Billed Revenue" : "Placement Revenue";
  const billedValue = period === "quarter-current" ? formatUsd(q2BilledRevenueUsd) : "$0";
  const billedHint =
    period === "quarter-current"
      ? "Sum of fees on placements with a start date in Apr 1 – Jun 30 2026 (Pending Start + Hired)."
      : "Fees earned on placements that hit start date.";

  return (
    <section className="rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-court-accent-dark">Billing Tower</div>
          <h2 className="mt-1 font-serif text-xl font-semibold text-court-fg">{activeLabel}</h2>
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Metric label={billedLabel} value={billedValue} hint={billedHint} />
        <Metric
          label="Cash Collected"
          value="$0"
          hint="Client payments received, regardless of placement date. Stays at $0 until invoices are paid."
        />
      </div>
    </section>
  );
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    // Sub-card sits inside the BillingTower's bg-court-surface section — using
    // `bg-court-surface-subtle` here lifts it a step against the parent
    // (mirrors the Hard palette's `bg-muted/50` visual rhythm in Clay + Grass).
    <div className="rounded-xl border border-court-border bg-court-surface-subtle px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">{label}</div>
        <div className="font-serif text-4xl font-extrabold leading-none tracking-tight text-court-fg">{value}</div>
      </div>
      <p className="mt-2 text-[11px] text-court-fg-muted">{hint}</p>
    </div>
  );
}
