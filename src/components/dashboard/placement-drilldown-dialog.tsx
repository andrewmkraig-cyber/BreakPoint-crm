"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import { formatMoneyShort } from "@/lib/placements-map-geo";
import { cn, formatDate } from "@/lib/utils";
import type {
  DrilldownResponse,
  DrilldownRow,
} from "@/app/api/dashboard/placement-drilldown/route";

// Shared drill-down popup for the Clubhouse dashboard. Opened by the
// Billing Tower tiles + the Scoreboard's Top Clients / Top Roles
// rows. Fetches placement rows on demand for the selected period so
// the parent page doesn't have to pay for both windows up front.

export type DrilldownQuery =
  | { kind: "billed_revenue" }
  | { kind: "cash_collected" }
  | { kind: "client"; id: string }
  | { kind: "role"; id: string };

type Period = "quarter" | "annual";

const STATUS_LABEL = {
  PENDING_START: "Pending",
  INVOICE_DRAFT: "Invoice Draft",
  // Single- and split-payment "invoice out the door" rows share the
  // same Invoice Sent label — see placements-ledger for the parent map.
  INVOICED: "Invoice Sent",
  BILLED: "Invoice Sent",
  PARTIALLY_PAID: "Partial",
  COLLECTED: "Paid",
  OVERDUE: "Overdue",
} as const;

const STATUS_PILL = {
  PENDING_START:
    "rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  // INVOICE_DRAFT → neutral slate chip; the invoice exists but the
  // recruiter hasn't sent it yet, so it sits quieter than the blue
  // Invoice Sent chip below.
  INVOICE_DRAFT:
    "rounded-full bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:border-slate-700",
  // INVOICED (split-payment, all DRAFT/SENT, none paid) shares the
  // blue Invoice Sent chip with BILLED so the eye reads one bucket.
  INVOICED:
    "rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  BILLED:
    "rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  // Split-payment PARTIALLY_PAID → yellow chip in the amber/yellow
  // "in-flight" family; brighter than amber Pending Start.
  PARTIALLY_PAID:
    "rounded-full bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
  COLLECTED:
    "rounded-md border border-court-brand bg-transparent text-court-brand",
  OVERDUE:
    "rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
} as const;

type Props = {
  title: string;
  // Optional eyebrow shown above the title (e.g., "Billing Tower").
  eyebrow?: string;
  query: DrilldownQuery;
  onClose: () => void;
};

export function PlacementDrilldownDialog({ title, eyebrow, query, onClose }: Props) {
  const [period, setPeriod] = useState<Period>("quarter");
  const [data, setData] = useState<DrilldownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ kind: query.kind, period });
    if (query.kind === "client" || query.kind === "role") {
      params.set("id", query.id);
    }
    fetch(`/api/dashboard/placement-drilldown?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return (await res.json()) as DrilldownResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, period]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-court-border-soft px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-brand-dark">
                {eyebrow}
              </p>
            )}
            <h2 className="mt-0.5 truncate font-serif text-lg font-bold tracking-tight text-court-fg">
              {title}
            </h2>
            <p className="mt-0.5 text-[11px] text-court-fg-muted">
              {loading
                ? "Loading…"
                : data
                  ? `${data.count} placement${data.count === 1 ? "" : "s"} · ${
                      data.totalFee > 0 ? formatMoneyShort(data.totalFee) : "—"
                    }`
                  : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              role="tablist"
              aria-label="Period"
              className="inline-flex items-center gap-0.5 rounded-md border border-court-border bg-court-surface-subtle/40 p-0.5"
            >
              <PeriodTab active={period === "quarter"} onClick={() => setPeriod("quarter")}>
                Quarter
              </PeriodTab>
              <PeriodTab active={period === "annual"} onClick={() => setPeriod("annual")}>
                Annual
              </PeriodTab>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-court-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading placements…
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {!loading && !error && data && data.rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle px-4 py-8 text-center text-sm text-court-fg-muted">
              No placements in this window.
            </div>
          )}
          {!loading && !error && data && data.rows.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {data.rows.map((r) => (
                <DrilldownRowItem key={r.placementId} row={r} onNavigate={onClose} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-[11px] font-semibold transition",
        active
          ? "bg-court-surface text-court-fg shadow-sm"
          : "text-court-fg-muted hover:text-court-fg",
      )}
    >
      {children}
    </button>
  );
}

function DrilldownRowItem({
  row,
  onNavigate,
}: {
  row: DrilldownRow;
  onNavigate: () => void;
}) {
  // formatDate, not a raw toLocaleDateString: startDateIso is expectedStartDate
  // (date-only, midnight UTC → must render in UTC or ET shows the day before)
  // but falls back to placedAt (a real click-time instant → renders local).
  // formatDate picks the right zone per value.
  const startDateLabel = formatDate(row.startDateIso, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }, "en-US");
  const fee =
    row.feeAmount != null && row.feeAmount > 0
      ? formatMoneyShort(row.feeAmount)
      : "—";
  const content = (
    <div className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-court-fg">
          {row.candidateName}
        </div>
        <div className="truncate text-[11px] text-court-fg-muted">
          {row.roleTitle || "—"}
          {row.clientName ? <span className="mx-1.5 text-court-fg-dim">·</span> : null}
          {row.clientName}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="text-[13px] font-semibold tabular-nums text-court-fg">
          {fee}
        </span>
        <span className="text-[10.5px] tabular-nums text-court-fg-muted">
          {startDateLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide",
            STATUS_PILL[row.billingStatus],
          )}
        >
          {STATUS_LABEL[row.billingStatus]}
        </span>
        {row.primaryHref && (
          <ExternalLink className="h-3 w-3 text-court-fg-muted" aria-hidden="true" />
        )}
      </div>
    </div>
  );
  if (row.primaryHref) {
    return (
      <li>
        <Link
          href={row.primaryHref}
          onClick={onNavigate}
          className="block rounded-lg border border-court-border-soft bg-court-surface transition hover:border-court-brand/40 hover:bg-court-brand-tint/30"
        >
          {content}
        </Link>
      </li>
    );
  }
  return (
    <li className="rounded-lg border border-court-border-soft bg-court-surface">
      {content}
    </li>
  );
}
