"use client";

import { useMemo, useState } from "react";

import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";
import { formatMoneyShort } from "@/lib/placements-map-geo";
import { formatDate } from "@/lib/utils";
import {
  PlacementEditDrawer,
  type PlacementDrawerContext,
} from "@/app/pipeline/placement-edit-drawer";

// Ledger row data the table actually renders. Trimmed from the full
// dashboard row + flattened to primitives so we don't ship Date objects
// over the server/client boundary. Dates render as YYYY-MM-DD strings.
export type LedgerRow = {
  id: string;
  stage: "offer" | "pending_start" | "hired";
  candidateId: string | null;
  candidateFullName: string;
  invoiceId: string | null;
  clientName: string;
  clientIndustry: string | null;
  roleTitle: string | null;
  city: string | null;
  // Raw Placement.cityOverride — what the drawer's City input should
  // seed from. Distinct from `city` which already resolves the
  // override → client-location fallback for display.
  cityOverride: string | null;
  startDateLabel: string | null;
  // ISO string used to seed the drawer's date input. Separate from the
  // YYYY-MM-DD label above so the ledger column stays formatted while
  // the drawer can re-parse a full ISO.
  expectedStartDateIso: string | null;
  feeAmount: number | null;
  feeTotal: number | null;
  feePercentage: number | null;
  placementNotes: string | null;
  acceptedSalary: number | null;
  candidateSource: string | null;
  billingStatus: PlacementsDashboardBillingStatus;
  leadSource: string | null;
  // Custom payment agreement fields, threaded through to seed the edit
  // drawer. customGuaranteeDate is an ISO string (serialized in
  // toLedgerRows) so it crosses the server/client boundary cleanly.
  useCustomTerms: boolean;
  installmentCount: number | null;
  inst1Amount: number | null;
  inst1DaysAfterStart: number | null;
  inst2Amount: number | null;
  inst2DaysAfterStart: number | null;
  inst3Amount: number | null;
  inst3DaysAfterStart: number | null;
  customGuaranteeDate: string | null;
  // Default guarantee window in days from start. Used downstream (outside
  // this component) to render the live "Guarantee Period" countdown card
  // beneath the ledger. Not consumed by the ledger render itself.
  guaranteePeriodDays: number | null;
};

const STAGE_LABEL: Record<LedgerRow["stage"], string> = {
  offer: "Offer",
  pending_start: "Pending start",
  hired: "Hired",
};

type FilterId = "ALL" | PlacementsDashboardBillingStatus;

// Filter tabs across the top of the ledger. Order: pre-start → invoice
// drafted → invoice sent (single + split) → partially paid → paid →
// overdue. "Invoice Sent" intentionally appears twice in the filter
// model (BILLED + INVOICED) under the same display label because the
// recruiter shouldn't have to track single-vs-split-payment as separate
// terminology; the counts are summed visually by the eye.
const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "PENDING_START", label: "Pending Start" },
  { id: "INVOICE_DRAFT", label: "Invoice Draft" },
  { id: "INVOICED", label: "Invoice Sent" },
  { id: "BILLED", label: "Invoice Sent" },
  { id: "PARTIALLY_PAID", label: "Partially Paid" },
  { id: "COLLECTED", label: "Paid" },
  { id: "OVERDUE", label: "Overdue" },
];

// Row-pill labels: BILLED and INVOICED both surface as "Invoice Sent" —
// the recruiter's mental model only cares whether the invoice is out the
// door, not whether the placement is single- or split-payment. The
// underlying enum stays distinct so split-only logic (PARTIALLY_PAID
// resolution, future-invoice ordering) still has the signal it needs.
const STATUS_LABEL: Record<PlacementsDashboardBillingStatus, string> = {
  PENDING_START: "Pending Start",
  INVOICE_DRAFT: "Invoice Draft",
  INVOICED: "Invoice Sent",
  BILLED: "Invoice Sent",
  PARTIALLY_PAID: "Partially Paid",
  COLLECTED: "Paid",
  OVERDUE: "Overdue",
};

const STATUS_PILL: Record<PlacementsDashboardBillingStatus, string> = {
  PENDING_START:
    "rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  // INVOICE_DRAFT reuses the neutral/slate chip family — the invoice
  // exists but no money is in flight yet, so the chip is intentionally
  // quieter than the BILLED blue. Same tone as the split-payment
  // INVOICED chip below since they're the same conceptual state.
  INVOICE_DRAFT:
    "rounded-full bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:border-slate-700",
  // INVOICED (split-payment "all DRAFT/SENT, none paid yet"). Shares
  // the blue Invoice Sent chip family with BILLED so the eye reads one
  // surface for both single- and split-payment "out the door" rows.
  INVOICED:
    "rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  BILLED:
    "rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  // PARTIALLY_PAID uses the yellow palette — sibling of (but visually
  // brighter than) the amber Pending Start chip, keeping it in the
  // amber/yellow "in-flight" family without colliding.
  PARTIALLY_PAID:
    "rounded-full bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
  COLLECTED:
    "rounded-md border border-court-brand bg-transparent text-court-brand",
  OVERDUE:
    "rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
};

function toDrawerContext(row: LedgerRow): PlacementDrawerContext {
  return {
    placementId: row.id,
    candidateName: row.candidateFullName || "—",
    clientName: row.clientName || "—",
    jobTitle: row.roleTitle ?? "—",
    stage: row.stage,
    stageLabel: STAGE_LABEL[row.stage],
    expectedStartDate: row.expectedStartDateIso,
    acceptedSalary: row.acceptedSalary,
    feeTotal: row.feeTotal,
    feePercentage: row.feePercentage,
    placementNotes: row.placementNotes,
    candidateSource: row.candidateSource,
    cityOverride: row.cityOverride,
    useCustomTerms: row.useCustomTerms,
    installmentCount: row.installmentCount,
    inst1Amount: row.inst1Amount,
    inst1DaysAfterStart: row.inst1DaysAfterStart,
    inst2Amount: row.inst2Amount,
    inst2DaysAfterStart: row.inst2DaysAfterStart,
    inst3Amount: row.inst3Amount,
    inst3DaysAfterStart: row.inst3DaysAfterStart,
    customGuaranteeDate: row.customGuaranteeDate,
  };
}

export function PlacementsLedger({
  rows,
  title,
}: {
  rows: LedgerRow[];
  title: string;
}) {
  const [filter, setFilter] = useState<FilterId>("ALL");
  const [drawerCtx, setDrawerCtx] = useState<PlacementDrawerContext | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  function openRow(row: LedgerRow) {
    setDrawerCtx(toDrawerContext(row));
    setDrawerOpen(true);
  }

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = {
      ALL: rows.length,
      PENDING_START: 0,
      INVOICE_DRAFT: 0,
      INVOICED: 0,
      BILLED: 0,
      PARTIALLY_PAID: 0,
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
    <div className="rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex flex-col gap-2.5 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
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

      <div className="mt-2.5 overflow-x-auto px-4">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-court-border-soft text-left text-[10px] uppercase tracking-wide text-court-fg-muted">
              <th className="py-1.5 pr-3 font-semibold">Candidate</th>
              <th className="px-3 py-1.5 font-semibold">Role</th>
              <th className="px-3 py-1.5 font-semibold">Client</th>
              <th className="px-3 py-1.5 font-semibold">City</th>
              <th className="px-3 py-1.5 font-semibold">Start</th>
              <th className="px-3 py-1.5 text-right font-semibold">Fee</th>
              <th className="px-3 py-1.5 font-semibold">Source</th>
              <th className="py-1.5 pl-3 font-semibold">Billing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-[13px] text-court-fg-muted"
                >
                  {rows.length === 0
                    ? "No placements in this window."
                    : "No placements match the selected filter."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <LedgerTableRow
                  key={row.id}
                  row={row}
                  onOpen={() => openRow(row)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <PlacementEditDrawer
        open={drawerOpen}
        context={drawerCtx}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function LedgerTableRow({
  row,
  onOpen,
}: {
  row: LedgerRow;
  onOpen: () => void;
}) {
  const candidateLabel = row.candidateFullName || "—";
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Edit placement for ${candidateLabel}`}
      className="cursor-pointer border-b border-court-border-soft transition last:border-b-0 hover:bg-court-brand-tint/40 focus:bg-court-brand-tint/40 focus:outline-none"
    >
      <td className="py-1.5 pr-3 align-middle font-medium text-court-fg">
        {candidateLabel}
      </td>
      <td className="px-3 py-1.5 align-middle text-court-fg">{row.roleTitle ?? "—"}</td>
      <td className="px-3 py-1.5 align-middle">
        <div className="font-medium text-court-fg">{row.clientName || "—"}</div>
        <div className="text-[11px] text-court-fg-muted">
          {row.clientIndustry ?? "—"}
        </div>
      </td>
      <td className="px-3 py-1.5 align-middle text-court-fg-muted">
        {row.city ?? "—"}
      </td>
      <td className="px-3 py-1.5 align-middle tabular-nums text-court-fg-muted">
        {formatDate(row.startDateLabel)}
      </td>
      <td className="px-3 py-1.5 text-right align-middle tabular-nums font-medium text-court-fg">
        {row.feeAmount != null && row.feeAmount > 0
          ? formatMoneyShort(row.feeAmount)
          : "—"}
      </td>
      <td className="px-3 py-1.5 align-middle text-court-fg-muted">
        {row.leadSource ?? "—"}
      </td>
      <td className="py-1.5 pl-3 align-middle">
        <span
          className={
            "inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            STATUS_PILL[row.billingStatus]
          }
        >
          {STATUS_LABEL[row.billingStatus]}
        </span>
      </td>
    </tr>
  );
}
