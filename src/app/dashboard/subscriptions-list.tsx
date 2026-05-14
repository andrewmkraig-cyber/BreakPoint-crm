"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type RecurringRow = {
  key: string;
  toolName: string;
  catalogCost: number;
  totalYtdUsd: number;
  paidCount: number;
};

export type OneTimeRow = {
  key: string;
  toolName: string;
  amountUsd: number;
  date: Date | null;
};

export type MoneyInRow = {
  key: string;
  name: string;
  source: "Placement" | "Mercury Cashback";
  amountUsd: number;
  date: Date | null;
};

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}
function formatUsdCents(n: number): string {
  return USD_CENTS.format(n);
}
function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

const SECTION_PREVIEW = 10;

const RECURRING_GRID = "grid grid-cols-[1.6fr_0.9fr_0.6fr_1fr]";
const ONE_TIME_GRID = "grid grid-cols-[1.6fr_1fr_1fr]";
const MONEY_IN_GRID = "grid grid-cols-[1.6fr_0.9fr_1fr_1fr]";

export function SubscriptionsList({
  recurringMonthly,
  recurringAnnual,
  oneTime,
  moneyIn,
  monthlyRecurringUsd,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  oneTime: OneTimeRow[];
  moneyIn: MoneyInRow[];
  monthlyRecurringUsd: number;
}) {
  const monthlySubtotal = recurringMonthly.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const annualSubtotal = recurringAnnual.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const oneTimeSubtotal = oneTime.reduce((s, r) => s + r.amountUsd, 0);
  const moneyInTotal = moneyIn.reduce((s, r) => s + r.amountUsd, 0);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <RecurringSection
        title="Recurring monthly"
        rows={recurringMonthly}
        costLabel="Monthly cost"
        ytdSubtotal={monthlySubtotal}
        footerExtra={
          <span className="text-xs text-court-fg-muted">
            Monthly recurring cost{" "}
            <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
              {formatUsdCents(monthlyRecurringUsd)}
            </span>
          </span>
        }
      />

      <div className="h-px bg-court-border-soft" />

      <RecurringSection
        title="Recurring annual"
        rows={recurringAnnual}
        costLabel="Annual cost"
        ytdSubtotal={annualSubtotal}
      />

      <div className="h-px bg-court-border-soft" />

      <OneTimeSection rows={oneTime} subtotal={oneTimeSubtotal} />

      <div className="h-px bg-court-border-soft" />

      <MoneyInSection rows={moneyIn} total={moneyInTotal} />
    </div>
  );
}

function RecurringSection({
  title,
  rows,
  costLabel,
  ytdSubtotal,
  footerExtra,
}: {
  title: string;
  rows: RecurringRow[];
  costLabel: string;
  ytdSubtotal: number;
  footerExtra?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, SECTION_PREVIEW);
  const remaining = rows.length - SECTION_PREVIEW;

  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        {title}
      </p>
      {rows.length === 0 ? (
        <EmptyBlock>No matching charges this year.</EmptyBlock>
      ) : (
        <>
          <div
            className={`mt-2 ${RECURRING_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}
          >
            <span>Tool</span>
            <span className="text-right">{costLabel}</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Total YTD</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {visible.map((r) => (
              <RecurringRowItem key={r.key} row={r} />
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
        </>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-court-border-soft pt-2 text-xs text-court-fg-muted">
        <span>{footerExtra ?? <span>&nbsp;</span>}</span>
        <span>
          Subtotal YTD{" "}
          <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
            {formatUsd(ytdSubtotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

function RecurringRowItem({ row }: { row: RecurringRow }) {
  const initials = avatarFor(row.toolName);
  return (
    <li className={`${RECURRING_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span className="truncate font-medium text-court-fg">
          {row.toolName}
        </span>
      </div>
      <span className="text-right tabular-nums text-court-fg">
        {formatUsdCents(row.catalogCost)}
      </span>
      <span className="text-right tabular-nums text-court-fg">
        {row.paidCount}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsd(row.totalYtdUsd)}
      </span>
    </li>
  );
}

function OneTimeSection({
  rows,
  subtotal,
}: {
  rows: OneTimeRow[];
  subtotal: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, SECTION_PREVIEW);
  const remaining = rows.length - SECTION_PREVIEW;

  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        One-time / non-recurring
      </p>
      {rows.length === 0 ? (
        <EmptyBlock>No one-time charges logged this year.</EmptyBlock>
      ) : (
        <>
          <div
            className={`mt-2 ${ONE_TIME_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}
          >
            <span>Tool</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Date</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {visible.map((r) => (
              <OneTimeRowItem key={r.key} row={r} />
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
        </>
      )}
      <div className="mt-2 flex items-center justify-end border-t border-court-border-soft pt-2 text-xs text-court-fg-muted">
        <span>
          Subtotal YTD{" "}
          <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
            {formatUsd(subtotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

function OneTimeRowItem({ row }: { row: OneTimeRow }) {
  const initials = avatarFor(row.toolName);
  return (
    <li className={`${ONE_TIME_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span className="truncate font-medium text-court-fg">
          {row.toolName}
        </span>
      </div>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsdCents(row.amountUsd)}
      </span>
      <span className="text-right tabular-nums text-court-fg-muted">
        {formatDate(row.date)}
      </span>
    </li>
  );
}

function MoneyInSection({
  rows,
  total,
}: {
  rows: MoneyInRow[];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, SECTION_PREVIEW);
  const remaining = rows.length - SECTION_PREVIEW;

  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        Money in
      </p>
      {rows.length === 0 ? (
        <EmptyBlock>No revenue logged this year yet.</EmptyBlock>
      ) : (
        <>
          <div
            className={`mt-2 ${MONEY_IN_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}
          >
            <span>Item</span>
            <span>Source</span>
            <span className="text-right">Date</span>
            <span className="text-right">Amount</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {visible.map((r) => (
              <MoneyInRowItem key={r.key} row={r} />
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
        </>
      )}
      <div className="mt-2 flex items-center justify-end border-t border-court-border-soft pt-2 text-xs text-court-fg-muted">
        <span>
          Total money in{" "}
          <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
            {formatUsd(total)}
          </span>
        </span>
      </div>
    </div>
  );
}

function MoneyInRowItem({ row }: { row: MoneyInRow }) {
  return (
    <li className={`${MONEY_IN_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <span className="min-w-0 truncate font-medium text-court-fg">
        {row.name}
      </span>
      <span>
        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
          {row.source}
        </span>
      </span>
      <span className="text-right tabular-nums text-court-fg-muted">
        {formatDate(row.date)}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsdCents(row.amountUsd)}
      </span>
    </li>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-3 py-3 text-center text-xs text-court-fg-muted">
      {children}
    </div>
  );
}
