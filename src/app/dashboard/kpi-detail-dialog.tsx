"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  TIME_GRAIN_ITEMS,
  encodeTimeRange,
  type TimeGrain,
  type TimeRangeSelection,
} from "@/lib/time-range";
import type {
  KpiDetailResponse,
  KpiDetailRow,
} from "@/app/api/dashboard/kpi-detail/route";

// Clubhouse KPI drill-down popup. Opened from a clickable KPI tile,
// fetches the underlying rows for the chosen category + period on demand
// and lists them as plain-text lines linked to the client / candidate
// page. The Week/Month/Quarter/Year TabStrip runs in controlled mode and
// opens on the dashboard's current period so the row count matches the
// tile that launched it; switching grains re-queries at offset 0.

// Lowercase grain word for the empty-state copy ("Nothing yet this week").
const GRAIN_WORD: Record<TimeGrain, string> = {
  WEEK: "week",
  MONTH: "month",
  QUARTER: "quarter",
  YEAR: "year",
};

export function KpiDetailDialog({
  category,
  title,
  defaultSelection,
  onClose,
}: {
  category: string;
  title: string;
  defaultSelection: TimeRangeSelection;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<TimeRangeSelection>(defaultSelection);
  const [data, setData] = useState<KpiDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      category,
      range: encodeTimeRange(selection),
    });
    fetch(`/api/dashboard/kpi-detail?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return (await res.json()) as KpiDetailResponse;
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
  }, [category, selection]);

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
                  ? `${data.count} ${data.count === 1 ? "result" : "results"}`
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
          <TabStrip<TimeGrain>
            items={TIME_GRAIN_ITEMS}
            activeId={selection.grain}
            ariaLabel="Period"
            onChange={(grain) => setSelection({ grain, offset: 0 })}
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
              Nothing yet this {GRAIN_WORD[selection.grain]}
            </div>
          )}
          {!loading && !error && data && data.rows.length > 0 && (
            <ul className="flex flex-col gap-1">
              {data.rows.map((r) => (
                <KpiDetailRowItem key={r.key} row={r} onNavigate={onClose} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiDetailRowItem({
  row,
  onNavigate,
}: {
  row: KpiDetailRow;
  onNavigate: () => void;
}) {
  const body = (
    <>
      <span className="block break-words text-[13px] font-medium text-court-fg">
        {row.primary ?? row.text}
      </span>
      {row.detail && (
        <span className="mt-0.5 block break-words text-[12px] text-court-fg-muted">
          {row.detail}
        </span>
      )}
      {row.meta && (
        <span className="mt-0.5 block text-[11px] text-court-fg-muted/80">
          {row.meta}
        </span>
      )}
    </>
  );

  if (row.href) {
    return (
      <li>
        <Link
          href={row.href}
          onClick={onNavigate}
          className="block rounded-lg border border-court-border-soft bg-court-surface px-3 py-2.5 transition hover:border-court-brand/40 hover:bg-court-brand-tint/30"
        >
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-court-border-soft bg-court-surface px-3 py-2.5 text-court-fg-muted">
      {body}
    </li>
  );
}
