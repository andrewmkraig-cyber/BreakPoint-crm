"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type SubscriptionListRow = {
  key: string;
  toolName: string;
  category: string;
  cost: number | null;
  frequency: string | null;
  paidCount: number;
  totalYtdUsd: number;
  status: "Mercury matched" | "Manual";
};

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

const SECTION_PREVIEW = 10;

// Column template shared by header + rows. Cost is left-aligned per
// desk preference; Paid / Total YTD stay right-aligned since they read
// as numeric columns.
const ROW_GRID_CLASS =
  "grid grid-cols-[1.6fr_0.7fr_0.9fr_0.9fr_0.4fr_0.85fr_0.55fr]";

export function SubscriptionsList({
  recurring,
  oneTime,
  monthlyRecurringUsd,
}: {
  recurring: SubscriptionListRow[];
  oneTime: SubscriptionListRow[];
  monthlyRecurringUsd: number;
}) {
  if (recurring.length === 0 && oneTime.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-5">
      {recurring.length > 0 && (
        <Section
          title="Recurring subscriptions"
          rows={recurring}
          footer={
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-court-border-soft pt-2 text-xs text-court-fg-muted">
              <span>Monthly recurring cost</span>
              <span className="text-sm font-semibold tabular-nums text-court-fg">
                {formatUsd(monthlyRecurringUsd)}
              </span>
            </div>
          }
        />
      )}
      {recurring.length > 0 && oneTime.length > 0 && (
        <div className="h-px bg-court-border-soft" />
      )}
      {oneTime.length > 0 && (
        <Section title="One-time charges" rows={oneTime} />
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: SubscriptionListRow[];
  footer?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, SECTION_PREVIEW);
  const remaining = rows.length - SECTION_PREVIEW;

  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        {title}
      </p>
      <div className={`mt-2 ${ROW_GRID_CLASS} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}>
        <span>Tool</span>
        <span>Cost</span>
        <span>Category</span>
        <span>Frequency</span>
        <span className="text-right">Paid</span>
        <span className="text-right">Total YTD</span>
        <span className="text-right">Status</span>
      </div>
      <ul className="divide-y divide-court-border-soft">
        {visible.map((r) => (
          <RowItem key={r.key} row={r} />
        ))}
      </ul>
      {remaining > 0 && (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Show fewer" : `Show ${remaining} more`}
          </Button>
        </div>
      )}
      {footer}
    </div>
  );
}

function RowItem({ row }: { row: SubscriptionListRow }) {
  const initials = avatarFor(row.toolName);
  return (
    <li className={`${ROW_GRID_CLASS} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span className="truncate font-medium text-court-fg">
          {row.toolName}
        </span>
      </div>
      <span className="tabular-nums text-court-fg">
        {row.cost != null ? formatUsd(row.cost) : "—"}
      </span>
      <span>
        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
          {row.category}
        </span>
      </span>
      <span>
        {row.frequency ? (
          <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
            {row.frequency}
          </span>
        ) : (
          <span className="text-xs text-court-fg-dim">—</span>
        )}
      </span>
      <span className="text-right tabular-nums text-court-fg">
        {row.paidCount}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsd(row.totalYtdUsd)}
      </span>
      <span className="flex justify-end">
        <StatusChip status={row.status} />
      </span>
    </li>
  );
}

function StatusChip({
  status,
}: {
  status: "Mercury matched" | "Manual";
}) {
  if (status === "Mercury matched") {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-brand-dark">
        Matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
      Manual
    </span>
  );
}
