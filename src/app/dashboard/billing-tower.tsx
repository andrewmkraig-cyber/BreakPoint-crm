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

export function BillingTower() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("quarter-current");
  const activeLabel = PERIODS.find((p) => p.value === period)?.label ?? "";

  return (
    <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-brand-dark">Billing Tower</div>
          <h2 className="mt-1 font-serif text-xl font-semibold text-navy">{activeLabel}</h2>
        </div>
        <div className="relative">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as typeof period)}
            className="appearance-none rounded-lg border border-border bg-white py-2 pl-3 pr-9 text-sm font-medium text-navy shadow-sm focus:border-brand focus:outline-none"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Metric label="Placement Revenue" value="$0" hint="Fees earned on placements that hit start date." />
        <Metric label="Cash Collected" value="$0" hint="Client payments received, regardless of placement date." />
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-serif text-4xl font-extrabold leading-none tracking-tight text-navy">{value}</div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
