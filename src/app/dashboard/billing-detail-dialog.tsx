"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { cn } from "@/lib/utils";
import { encodeTimeRange, type TimeRangeSelection } from "@/lib/time-range";
import type { BillingDetailResponse } from "@/app/api/dashboard/billing-detail/route";

// Billing Tower drill-down popup — the Revenue / Outstanding sibling of
// KpiDetailDialog. Same chrome (backdrop, panel, header, TabStrip rail,
// scrolling row list) so clicking a tower number feels identical to
// clicking a KPI tile above it.
//
// The one deliberate difference is the period rail. KpiDetailDialog offers
// Week/Month/Quarter/Year; the Billing Tower only ever surfaces the four
// windows in its own dropdown (Goal math is quarter-anchored), so this rail
// carries those four and nothing else. It opens on whichever window the
// tower is showing, so the popup total always matches the number clicked.

type BillingWindowId = "current" | "next" | "previous" | "annual";

const WINDOW_SELECTION: Record<BillingWindowId, TimeRangeSelection> = {
  current: { grain: "QUARTER", offset: 0 },
  next: { grain: "QUARTER", offset: 1 },
  previous: { grain: "QUARTER", offset: -1 },
  annual: { grain: "YEAR", offset: 0 },
};

const WINDOW_ITEMS: ReadonlyArray<TabStripItem<BillingWindowId>> = [
  { id: "current", label: "This Quarter" },
  { id: "next", label: "Next Quarter" },
  { id: "previous", label: "Last Quarter" },
  { id: "annual", label: "Annual" },
];

// Map the tower's current TimeRangeSelection back onto a rail tab so the
// popup opens with the right pill lit. Anything unrecognized falls back to
// the current quarter, matching the tower's own default.
function windowIdFor(sel: TimeRangeSelection): BillingWindowId {
  if (sel.grain === "YEAR") return "annual";
  if (sel.grain === "QUARTER" && sel.offset === 1) return "next";
  if (sel.grain === "QUARTER" && sel.offset === -1) return "previous";
  return "current";
}

export function BillingDetailDialog({
  kind,
  title,
  defaultSelection,
  onClose,
}: {
  kind: "revenue" | "outstanding";
  title: string;
  defaultSelection: TimeRangeSelection;
  onClose: () => void;
}) {
  const [windowId, setWindowId] = useState<BillingWindowId>(() =>
    windowIdFor(defaultSelection),
  );
  const [data, setData] = useState<BillingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      kind,
      range: encodeTimeRange(WINDOW_SELECTION[windowId]),
    });
    fetch(`/api/dashboard/billing-detail?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return (await res.json()) as BillingDetailResponse;
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
  }, [kind, windowId]);

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
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-court-border bg-court-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-court-border-soft px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-lg font-bold tracking-tight text-court-fg">
              {title}
            </h2>
            <p className="mt-0.5 text-[11px] text-court-fg-muted">
              {loading
                ? "Loading…"
                : data
                  ? `${data.totalLabel} · ${data.count} ${
                      data.count === 1 ? "line" : "lines"
                    } · ${data.periodLabel}`
                  : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 px-1.5"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-court-border-soft px-5 py-2.5">
          <TabStrip<BillingWindowId>
            items={WINDOW_ITEMS}
            activeId={windowId}
            ariaLabel="Billing period"
            onChange={setWindowId}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-court-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}
          {!loading && !error && data && data.rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle px-4 py-8 text-center text-sm text-court-fg-muted">
              {kind === "outstanding"
                ? "Nothing outstanding in this period"
                : "No billing lines in this period"}
            </div>
          )}
          {!loading && !error && data && data.rows.length > 0 && (
            <ul className="flex flex-col gap-1">
              {data.rows.map((r) => {
                const body = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-court-fg">
                        {r.title}
                      </div>
                      {r.subtitle && (
                        <div className="truncate text-[11px] text-court-fg-muted">
                          {r.subtitle}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[13px] font-semibold tabular-nums text-court-fg">
                        {r.amountLabel}
                      </div>
                      <div
                        className={cn(
                          "text-[11px]",
                          r.paid ? "text-court-brand-dark" : "text-court-fg-muted",
                        )}
                      >
                        {r.statusLabel} · {r.dateLabel}
                      </div>
                    </div>
                  </div>
                );
                return r.href ? (
                  <li key={r.key}>
                    <Link
                      href={r.href}
                      onClick={onClose}
                      className="block rounded-lg border border-court-border-soft bg-court-surface px-3 py-2 transition hover:border-court-brand/40 hover:bg-court-brand-tint/30"
                    >
                      {body}
                    </Link>
                  </li>
                ) : (
                  <li
                    key={r.key}
                    className="rounded-lg border border-court-border-soft bg-court-surface px-3 py-2"
                  >
                    {body}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
