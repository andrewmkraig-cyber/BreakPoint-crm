"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import {
  STATUS_LABEL,
  STATUS_PILL,
} from "@/components/placements/placements-ledger";
import { guaranteeDaysRemaining } from "@/components/placements/guarantee-period-utils";
import { formatMoneyShort } from "@/lib/placements-map-geo";
import type { RetainedSearchCardRow } from "@/lib/retained-searches";
import { closeRetainedSearch } from "@/app/invoices/retained-search-actions";
import { cn } from "@/lib/utils";

// Retained Searches card, mounted above the placements ledger. Rooted at
// RetainedSearch rather than Placement so an OPEN search with no candidate
// yet still appears — the whole point of the card.
//
// Reuse, not re-implementation:
//   Invoice Status  → STATUS_LABEL / STATUS_PILL from placements-ledger,
//                     over a status the server derived with the ledger's own
//                     deriveBillingStatus.
//   Guarantee       → guaranteeDaysRemaining from guarantee-period-utils,
//                     the same math the guarantee-period table counts with.

const MS_PER_DAY = 86_400_000;

// Search-status chips, drawn from tones already in use: COLLECTED's brand
// outline for Filled, the neutral slate INVOICE_DRAFT family for Open, and
// the muted surface tone the ledger uses for quiet states. No new colors.
const SEARCH_STATUS_LABEL: Record<RetainedSearchCardRow["status"], string> = {
  OPEN: "Open",
  FILLED: "Filled",
  CLOSED_UNFILLED: "Closed Unfilled",
};

const SEARCH_STATUS_PILL: Record<RetainedSearchCardRow["status"], string> = {
  OPEN: "rounded-full bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:border-slate-700",
  FILLED: "rounded-md border border-court-brand bg-transparent text-court-brand",
  CLOSED_UNFILLED:
    "rounded-full bg-court-surface-subtle text-court-fg-muted border border-court-border-soft",
};

const PANEL_CLASS =
  "rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]";

export function RetainedSearchesCard({
  rows,
}: {
  rows: RetainedSearchCardRow[];
}) {
  const router = useRouter();
  const [closing, setClosing] = useState<RetainedSearchCardRow | null>(null);

  // Ticking `now` so the guarantee column counts down without a refresh.
  // Same cadence as GuaranteePeriodTable: align to the next midnight, then
  // once every 24h.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const nowMs = Date.now();
    const next = new Date(nowMs);
    next.setHours(24, 0, 0, 0);
    const msUntilMidnight = Math.max(60_000, next.getTime() - nowMs);
    const initial = setTimeout(tick, msUntilMidnight);
    const daily = setInterval(tick, MS_PER_DAY);
    return () => {
      clearTimeout(initial);
      clearInterval(daily);
    };
  }, []);

  // Closed-unfilled rows sink to the bottom, dimmed, the same way cancelled
  // placements sit under the Hired pipeline tab.
  const ordered = useMemo(() => {
    const live = rows.filter((r) => r.status !== "CLOSED_UNFILLED");
    const closed = rows.filter((r) => r.status === "CLOSED_UNFILLED");
    return [...live, ...closed];
  }, [rows]);

  return (
    <div className={PANEL_CLASS}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
        Retained Searches
      </p>

      {ordered.length === 0 ? (
        <p className="mt-3 text-[13px] text-court-fg-muted">
          No retained searches yet.
        </p>
      ) : (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-court-border-soft text-left text-[10px] uppercase tracking-wide text-court-fg-muted">
                <th className="py-1.5 pr-3 font-semibold">Client</th>
                <th className="px-3 py-1.5 font-semibold">Job Title</th>
                <th className="px-3 py-1.5 text-right font-semibold">Retainer</th>
                <th className="px-3 py-1.5 font-semibold">Invoice</th>
                <th className="px-3 py-1.5 font-semibold">Search</th>
                <th className="px-3 py-1.5 font-semibold">Guarantee</th>
                <th className="py-1.5 pl-3" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <RetainedRow
                  key={row.id}
                  row={row}
                  now={now}
                  onOpen={() => {
                    if (row.invoiceId) router.push(`/invoices/${row.invoiceId}`);
                  }}
                  onClose={() => setClosing(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closing && (
        <CloseSearchDialog
          row={closing}
          onCancel={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RetainedRow({
  row,
  now,
  onOpen,
  onClose,
}: {
  row: RetainedSearchCardRow;
  now: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const isClosed = row.status === "CLOSED_UNFILLED";
  const clickable = row.invoiceId != null;

  // Blank while OPEN: the guarantee clock starts on the candidate's start
  // date, which does not exist until the search is filled.
  const daysRemaining =
    row.status === "FILLED" && row.guaranteeEndIso
      ? guaranteeDaysRemaining(row.guaranteeEndIso, now)
      : null;
  const guaranteeLabel =
    row.status !== "FILLED"
      ? ""
      : daysRemaining != null
        ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`
        : row.guaranteeEndIso
          ? "Elapsed"
          : "—";

  return (
    <tr
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? "button" : undefined}
      aria-label={
        clickable
          ? `Open invoice for ${row.jobTitle || "retained search"} at ${row.clientName || "client"}`
          : undefined
      }
      className={cn(
        "border-b border-court-border-soft transition last:border-b-0",
        clickable &&
          "cursor-pointer hover:bg-court-surface-subtle/60 focus:bg-court-surface-subtle/60 focus:outline-none",
        isClosed && "opacity-60",
      )}
    >
      <td className="py-1.5 pr-3 align-middle font-medium text-court-fg">
        {row.clientName || "—"}
      </td>
      <td className="px-3 py-1.5 align-middle text-court-fg">
        {row.jobTitle || "—"}
        {isClosed && row.closeReason ? (
          <div className="text-[11px] text-court-fg-muted">{row.closeReason}</div>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-right align-middle tabular-nums font-medium text-court-fg">
        {row.totalAmount > 0 ? formatMoneyShort(row.totalAmount) : "—"}
      </td>
      <td className="px-3 py-1.5 align-middle">
        {row.billingStatus ? (
          <span
            className={
              "inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
              STATUS_PILL[row.billingStatus]
            }
          >
            {STATUS_LABEL[row.billingStatus]}
          </span>
        ) : (
          <span className="text-court-fg-muted">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 align-middle">
        <span
          className={
            "inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            SEARCH_STATUS_PILL[row.status]
          }
        >
          {SEARCH_STATUS_LABEL[row.status]}
        </span>
      </td>
      <td className="px-3 py-1.5 align-middle tabular-nums text-court-fg-muted">
        {guaranteeLabel}
      </td>
      <td className="py-1.5 pl-3 text-right align-middle">
        {row.status === "OPEN" && (
          <Button
            variant="reject"
            size="sm"
            // The row itself navigates to the invoice; closing is its own
            // intent and must not trigger that.
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Close search
          </Button>
        )}
      </td>
    </tr>
  );
}

function CloseSearchDialog({
  row,
  onCancel,
  onClosed,
}: {
  row: RetainedSearchCardRow;
  onCancel: () => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function confirm() {
    if (saving) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Add a short reason for closing.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await closeRetainedSearch({
        retainedSearchId: row.id,
        closeReason: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
        setSaving(false);
        return;
      }
      onClosed();
    } catch {
      setError("Something went wrong closing the search.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Close retained search"
        className="w-full max-w-md rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Close this search?
        </h2>
        <p className="mt-2 text-[13px] text-court-fg-muted">
          {`${row.jobTitle || "This search"} at ${row.clientName || "this client"} will be marked closed and unfilled. Any invoice already sent or paid stays exactly as it is. Nothing is voided or refunded.`}
        </p>

        <Textarea
          label="Reason"
          containerClassName="mt-4"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Client paused the search"
          maxLength={500}
        />

        {error && (
          <p className="mt-2 text-[11px] font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="reject" size="sm" onClick={confirm} disabled={saving}>
            {saving ? "Closing..." : "Close search"}
          </Button>
        </div>
      </div>
    </div>
  );
}
