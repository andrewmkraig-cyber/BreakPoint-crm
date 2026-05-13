"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";

// Ledger row data the table actually renders. Trimmed from the full
// dashboard row + flattened to primitives so we don't ship Date objects
// over the server/client boundary. Dates render as YYYY-MM-DD strings.
export type LedgerRow = {
  id: string;
  candidateId: string | null;
  candidateFullName: string;
  invoiceId: string | null;
  clientName: string;
  clientIndustry: string | null;
  roleTitle: string | null;
  city: string | null;
  startDateLabel: string | null;
  feeAmount: number | null;
  billingStatus: PlacementsDashboardBillingStatus;
};

type FilterId = "ALL" | PlacementsDashboardBillingStatus;

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "PENDING_START", label: "Pending Start" },
  { id: "BILLED", label: "Billed" },
  { id: "COLLECTED", label: "Collected" },
  { id: "OVERDUE", label: "Overdue" },
];

const STATUS_LABEL: Record<PlacementsDashboardBillingStatus, string> = {
  PENDING_START: "Pending Start",
  BILLED: "Billed",
  COLLECTED: "Collected",
  OVERDUE: "Overdue",
};

const STATUS_PILL: Record<PlacementsDashboardBillingStatus, string> = {
  PENDING_START:
    "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  BILLED:
    "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  COLLECTED:
    "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  OVERDUE:
    "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
};

function formatMoneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// Click target priority: if a placement has a linked invoice, sending
// the recruiter to the invoice is more useful (billing context). Else
// fall back to the candidate detail page where the placement record
// itself lives. There's no /placements/[id] route in this CRM.
function rowHref(row: LedgerRow): string | null {
  if (row.invoiceId) return `/invoices/${row.invoiceId}`;
  if (row.candidateId) return `/candidates/${row.candidateId}`;
  return null;
}

export function PlacementsLedger({
  rows,
  title,
}: {
  rows: LedgerRow[];
  title: string;
}) {
  const [filter, setFilter] = useState<FilterId>("ALL");

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = {
      ALL: rows.length,
      PENDING_START: 0,
      BILLED: 0,
      COLLECTED: 0,
      OVERDUE: 0,
    };
    for (const r of rows) c[r.billingStatus] += 1;
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((r) => r.billingStatus === filter)),
    [rows, filter],
  );

  return (
    <div className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          {title}
        </p>
        <div
          role="tablist"
          aria-label="Placements billing filter"
          className="inline-flex flex-wrap items-center gap-1"
        >
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setFilter(f.id)}
                className={
                  "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] transition-colors " +
                  (active
                    ? "border-court-brand bg-transparent font-semibold text-court-brand"
                    : "border-transparent bg-transparent font-medium text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg")
                }
              >
                <span>{f.label}</span>
                <span
                  className={
                    "ml-0.5 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " +
                    (active
                      ? "bg-court-brand-tint text-court-brand-dark"
                      : "bg-court-surface-subtle text-court-fg-muted")
                  }
                >
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-court-border-soft text-left text-[11px] uppercase tracking-wide text-court-fg-muted">
              <th className="px-5 py-2 font-semibold">Candidate</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Client</th>
              <th className="px-3 py-2 font-semibold">City</th>
              <th className="px-3 py-2 font-semibold">Start</th>
              <th className="px-3 py-2 text-right font-semibold">Fee</th>
              <th className="px-5 py-2 font-semibold">Billing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-8 text-center text-sm text-court-fg-muted"
                >
                  {rows.length === 0
                    ? "No placements in this window."
                    : "No placements match the selected filter."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => <LedgerTableRow key={row.id} row={row} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LedgerTableRow({ row }: { row: LedgerRow }) {
  const href = rowHref(row);
  const rowClass =
    "border-b border-court-border-soft transition hover:bg-court-brand-tint/40" +
    (href ? " cursor-pointer" : "");
  const candidateLabel = row.candidateFullName || "—";
  return (
    <tr className={rowClass}>
      <td className="px-5 py-2.5 align-top font-medium text-court-fg">
        {href ? (
          <Link
            href={href}
            className="block hover:text-court-brand-dark hover:underline"
          >
            {candidateLabel}
          </Link>
        ) : (
          candidateLabel
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-court-fg">{row.roleTitle ?? "—"}</td>
      <td className="px-3 py-2.5 align-top">
        <div className="font-medium text-court-fg">{row.clientName || "—"}</div>
        <div className="text-[11px] text-court-fg-muted">
          {row.clientIndustry ?? "—"}
        </div>
      </td>
      <td className="px-3 py-2.5 align-top text-court-fg-muted">
        {row.city ?? "—"}
      </td>
      <td className="px-3 py-2.5 align-top tabular-nums text-court-fg-muted">
        {row.startDateLabel ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums font-medium text-court-fg">
        {row.feeAmount != null && row.feeAmount > 0
          ? formatMoneyShort(row.feeAmount)
          : "—"}
      </td>
      <td className="px-5 py-2.5 align-top">
        <span
          className={
            "inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            STATUS_PILL[row.billingStatus]
          }
        >
          {STATUS_LABEL[row.billingStatus]}
        </span>
      </td>
    </tr>
  );
}
