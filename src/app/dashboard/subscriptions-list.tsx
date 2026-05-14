"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  updateToolExpense,
  deleteToolExpense,
} from "@/app/dashboard/expense-actions";

export type RecurringRow = {
  key: string;
  toolName: string;
  catalogCost: number;
  totalYtdUsd: number;
  paidCount: number;
  matched: boolean;
  subline?: string;
  // When set, this row is backed by a ToolExpense row and the trash /
  // pencil affordances render. Mercury-matched + catalog rows leave
  // it blank.
  toolExpenseId?: string;
  startDate?: Date | null;
  notes?: string;
};

export type OneTimeRow = {
  key: string;
  toolName: string;
  amountUsd: number;
  date: Date | null;
  notes?: string;
  matched: boolean;
  toolExpenseId?: string;
};

export type MoneyInRow = {
  key: string;
  source: string;
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
function dateInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SECTION_PREVIEW = 10;

// Recurring + one-time both reserve an actions column at the end.
// Tool gets the lion's share of width so 1440px viewports never
// truncate the longest manual entries (e.g. "Lone Wolf Course",
// "LLC Formation Filing"). minmax(0, …) on Tool lets the column
// shrink below its fr-derived width and truncate cleanly at narrower
// viewports instead of overflowing into the next column.
const RECURRING_GRID =
  "grid grid-cols-[minmax(0,2fr)_minmax(70px,0.9fr)_minmax(80px,1fr)_minmax(0,0.8fr)_56px]";
// Date drops out below lg (1024px) so Tool + Amount + Notes still
// breathe on laptop-tier card widths. Header + each row mirror the
// hide-and-restore pattern via hidden lg:block on the Date cell.
const ONE_TIME_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(80px,0.8fr)_minmax(0,1.3fr)_56px] lg:grid-cols-[minmax(0,2.2fr)_minmax(80px,0.8fr)_minmax(90px,0.9fr)_minmax(0,1.3fr)_56px]";
const MONEY_IN_GRID = "grid grid-cols-[minmax(0,1.6fr)_1fr_1fr]";

function MatchedPill() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-court-brand-dark">
      Matched
    </span>
  );
}

export function SubscriptionsList({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
  oneTime,
  moneyIn,
  monthlyRecurringUsd,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
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
  const every3YearsSubtotal = recurringEvery3Years.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const oneTimeSubtotal = oneTime.reduce((s, r) => s + r.amountUsd, 0);
  const moneyInTotal = moneyIn.reduce((s, r) => s + r.amountUsd, 0);

  const monthlyRecurringTotal = recurringMonthly.reduce(
    (s, r) => s + r.catalogCost,
    0,
  );
  const annualRecurringTotal = recurringAnnual.reduce(
    (s, r) => s + r.catalogCost,
    0,
  );
  const every3YearsTotal = recurringEvery3Years.reduce(
    (s, r) => s + r.catalogCost,
    0,
  );

  return (
    <div className="mt-4 flex flex-col gap-6">
      <RecurringSection
        title="Recurring monthly"
        rows={recurringMonthly}
        costLabel="Monthly Cost"
        ytdSubtotal={monthlySubtotal}
        footerTotalLabel="Monthly Recurring Total"
        footerTotalUsd={monthlyRecurringTotal}
        footerExtra={
          <span className="text-xs text-court-fg-muted">
            Monthly burn{" "}
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
        costLabel="Annual Cost"
        ytdSubtotal={annualSubtotal}
        footerTotalLabel="Annual Recurring Total"
        footerTotalUsd={annualRecurringTotal}
      />

      {recurringEvery3Years.length > 0 ? (
        <>
          <div className="h-px bg-court-border-soft" />
          <RecurringSection
            title="Every 3 years"
            rows={recurringEvery3Years}
            costLabel="Per-Cycle Cost"
            ytdSubtotal={every3YearsSubtotal}
            footerTotalLabel="Every-3-Years Total"
            footerTotalUsd={every3YearsTotal}
          />
        </>
      ) : null}

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
  footerTotalLabel,
  footerTotalUsd,
  footerExtra,
}: {
  title: string;
  rows: RecurringRow[];
  costLabel: string;
  ytdSubtotal: number;
  footerTotalLabel: string;
  footerTotalUsd: number;
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
            <span className="text-right">Total Paid YTD</span>
            <span className="text-right">Status</span>
            <span />
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
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-court-border-soft pt-2 text-xs text-court-fg-muted">
        <span>{footerExtra ?? <span>&nbsp;</span>}</span>
        <span className="flex items-baseline gap-3">
          <span>
            Subtotal YTD{" "}
            <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
              {formatUsd(ytdSubtotal)}
            </span>
          </span>
          <span>
            {footerTotalLabel}{" "}
            <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
              {formatUsdCents(footerTotalUsd)}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

function RecurringRowItem({ row }: { row: RecurringRow }) {
  const [editing, setEditing] = useState(false);
  const initials = avatarFor(row.toolName);

  if (editing && row.toolExpenseId) {
    return (
      <li className="px-1 py-2">
        <RecurringEditForm
          row={row}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`${RECURRING_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-medium text-court-fg"
            title={row.toolName}
          >
            {row.toolName}
          </div>
          {row.subline ? (
            <div
              className="truncate text-[11px] text-court-fg-muted"
              title={row.subline}
            >
              {row.subline}
            </div>
          ) : null}
        </div>
      </div>
      <span className="text-right tabular-nums text-court-fg">
        {formatUsdCents(row.catalogCost)}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {row.totalYtdUsd > 0 ? formatUsdCents(row.totalYtdUsd) : "—"}
      </span>
      <span className="flex items-center justify-end">
        {row.matched ? <MatchedPill /> : null}
      </span>
      <span className="flex items-center justify-end">
        {row.toolExpenseId ? (
          <ToolExpenseRowActions
            id={row.toolExpenseId}
            onEdit={() => setEditing(true)}
          />
        ) : null}
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
            <span className="hidden text-right lg:block">Date</span>
            <span>Notes</span>
            <span />
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
          One-Time Total{" "}
          <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
            {formatUsdCents(subtotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

function OneTimeRowItem({ row }: { row: OneTimeRow }) {
  const [editing, setEditing] = useState(false);
  const initials = avatarFor(row.toolName);

  if (editing && row.toolExpenseId) {
    return (
      <li className="px-1 py-2">
        <OneTimeEditForm
          row={row}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`${ONE_TIME_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="min-w-0 truncate font-medium text-court-fg"
            title={row.toolName}
          >
            {row.toolName}
          </span>
          {row.matched ? <MatchedPill /> : null}
        </div>
      </div>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsdCents(row.amountUsd)}
      </span>
      <span className="hidden text-right tabular-nums text-court-fg-muted lg:block">
        {formatDate(row.date)}
      </span>
      <span
        className="truncate text-xs text-court-fg-muted"
        title={row.notes ?? ""}
      >
        {row.notes ?? ""}
      </span>
      <span className="flex items-center justify-end">
        {row.toolExpenseId ? (
          <ToolExpenseRowActions
            id={row.toolExpenseId}
            onEdit={() => setEditing(true)}
          />
        ) : null}
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
            <span>Source</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Date</span>
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
          Total Money In{" "}
          <span className="ml-1 text-sm font-semibold tabular-nums text-court-fg">
            {formatUsdCents(total)}
          </span>
        </span>
      </div>
    </div>
  );
}

function MoneyInRowItem({ row }: { row: MoneyInRow }) {
  return (
    <li className={`${MONEY_IN_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <span
        className="min-w-0 truncate font-medium text-court-fg"
        title={row.source}
      >
        {row.source}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsdCents(row.amountUsd)}
      </span>
      <span className="text-right tabular-nums text-court-fg-muted">
        {formatDate(row.date)}
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

// ---- ToolExpense edit / delete affordances ----

function ToolExpenseRowActions({
  id,
  onEdit,
}: {
  id: string;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteToolExpense(id);
      if (res.ok) setConfirming(false);
    });
  };

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Edit expense"
        onClick={onEdit}
        className="grid h-6 w-6 place-items-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Delete expense"
        onClick={() => setConfirming((v) => !v)}
        className="grid h-6 w-6 place-items-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-red-600"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {confirming ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-court-border bg-court-surface p-3 shadow-lg">
          <p className="text-xs font-semibold text-court-fg">
            Delete this expense?
          </p>
          <p className="mt-1 text-[11px] text-court-fg-muted">
            This can&apos;t be undone.
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-md border border-court-border px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function RecurringEditForm({
  row,
  onCancel,
  onSaved,
}: {
  row: RecurringRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.toolName);
  const [cost, setCost] = useState(row.catalogCost.toString());
  const [notes, setNotes] = useState(row.subline ?? row.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    if (!row.toolExpenseId) return;
    const parsedCost = Number(cost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateToolExpense({
        id: row.toolExpenseId!,
        name,
        cost: parsedCost,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className="rounded-lg border border-court-brand/30 bg-court-brand-tint/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_0.9fr_2fr]">
        <FieldText label="Name" value={name} onChange={setName} />
        <FieldNumber label="Cost" value={cost} onChange={setCost} />
        <FieldText label="Notes" value={notes} onChange={setNotes} />
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-red-600">{error}</p>
      ) : null}
      <FormButtons pending={pending} onCancel={onCancel} onSave={handleSave} />
    </div>
  );
}

function OneTimeEditForm({
  row,
  onCancel,
  onSaved,
}: {
  row: OneTimeRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.toolName);
  const [amount, setAmount] = useState(row.amountUsd.toString());
  const [date, setDate] = useState(dateInputValue(row.date));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    if (!row.toolExpenseId) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError("Amount must be a non-negative number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateToolExpense({
        id: row.toolExpenseId!,
        name,
        cost: parsedAmount,
        startDate: date || null,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className="rounded-lg border border-court-brand/30 bg-court-brand-tint/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.6fr_0.9fr_1fr_1.5fr]">
        <FieldText label="Name" value={name} onChange={setName} />
        <FieldNumber label="Amount" value={amount} onChange={setAmount} />
        <FieldDate label="Date" value={date} onChange={setDate} />
        <FieldText label="Notes" value={notes} onChange={setNotes} />
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-red-600">{error}</p>
      ) : null}
      <FormButtons pending={pending} onCancel={onCancel} onSave={handleSave} />
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg focus:border-court-brand focus:outline-none"
      />
    </label>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm tabular-nums text-court-fg focus:border-court-brand focus:outline-none"
      />
    </label>
  );
}

function FieldDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg focus:border-court-brand focus:outline-none"
      />
    </label>
  );
}

function FormButtons({
  pending,
  onCancel,
  onSave,
}: {
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-court-border px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-2 py-1 text-[11px] font-semibold text-court-brand-dark transition hover:bg-court-brand/25 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Check className="h-3 w-3" />
        )}
        Save
      </button>
    </div>
  );
}
