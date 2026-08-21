"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  MaskedCurrencyInput,
  formatCurrency,
} from "@/components/ui/masked-currency-input";
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  PAYMENT_TERMS_OPTIONS,
  dueDateIsoFromTerms,
  paymentTermsLabel,
} from "@/lib/payment-terms";
import { cn } from "@/lib/utils";
import { createRetainedSearch } from "@/app/invoices/retained-search-actions";

// "Send Retained Invoice" modal, opened from the topbar action on
// /invoices. The topbar lives in AppShell, far above this page, so the
// button crosses the boundary with a window event the same way
// CalendarNewEventButton / NewExpenseTopBarButton already do.
//
// This prompt only writes the RetainedSearch row. The invoice itself is
// generated in the next prompt, so Save closes and refreshes rather than
// navigating to an invoice.

export const RETAINED_SEARCH_OPEN_EVENT = "ace:retained-search:new";

export type RetainedSearchClientOption = { id: string; name: string };
export type RetainedSearchJobOption = {
  id: string;
  title: string;
  clientId: string | null;
};

type InstallmentRow = {
  // Stable key so React does not reorder inputs when a row is removed.
  key: string;
  // Clean digit string from MaskedCurrencyInput ("" when empty).
  amount: string;
  dueDate: string;
};

const DEFAULT_TERMS = paymentTermsLabel(DEFAULT_PAYMENT_TERMS_DAYS);

function todayIso(): string {
  // Local calendar day, formatted as the YYYY-MM-DD an <input type="date">
  // speaks. Matches how the invoice editor seeds its issue date.
  const now = new Date();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function newInstallmentRow(dueDate: string): InstallmentRow {
  return {
    key: `inst-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    amount: "",
    dueDate,
  };
}

function digitsToDollars(digits: string): number {
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SECTION_LABEL_CLASS =
  "mb-1 block text-xs uppercase tracking-wide text-court-fg-muted";
const HINT_CLASS = "mt-1 text-[11px] text-court-fg-muted";

export function RetainedSearchModal({
  clients,
  jobs,
}: {
  clients: RetainedSearchClientOption[];
  jobs: RetainedSearchJobOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [clientId, setClientId] = useState("");
  const [jobId, setJobId] = useState("");
  const [totalDigits, setTotalDigits] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(DEFAULT_TERMS);
  const [useInstallments, setUseInstallments] = useState(false);
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [guaranteeDays, setGuaranteeDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setClientId("");
    setJobId("");
    setTotalDigits("");
    setPaymentTerms(DEFAULT_TERMS);
    setUseInstallments(false);
    setInstallments([]);
    setGuaranteeDays("");
    setError(null);
    setSaving(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  // Topbar bridge. Opening always starts from a clean form.
  useEffect(() => {
    function onOpen() {
      reset();
      setOpen(true);
    }
    window.addEventListener(RETAINED_SEARCH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(RETAINED_SEARCH_OPEN_EVENT, onOpen);
  }, [reset]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Jobs are filtered to the selected client. Jobs with no client attached
  // never appear, since a retainer is always sold against a named client.
  const jobsForClient = useMemo(
    () => (clientId ? jobs.filter((j) => j.clientId === clientId) : []),
    [clientId, jobs],
  );

  // Changing the client invalidates a job picked under the previous one.
  useEffect(() => {
    if (jobId && !jobsForClient.some((j) => j.id === jobId)) setJobId("");
  }, [jobId, jobsForClient]);

  // Read-only due date, recomputed live from today + the selected terms so
  // the recruiter can see what the terms actually mean before saving.
  const issueDate = todayIso();
  const dueDateIso = useMemo(
    () => dueDateIsoFromTerms(issueDate, paymentTerms),
    [issueDate, paymentTerms],
  );

  const totalDollars = digitsToDollars(totalDigits);
  const installmentSum = installments.reduce(
    (s, r) => s + digitsToDollars(r.amount),
    0,
  );
  const installmentsMatch = installmentSum === totalDollars;
  const showInstallmentWarning =
    useInstallments && installments.length > 0 && !installmentsMatch;

  function toggleInstallments() {
    const next = !useInstallments;
    // Seed two rows on first turn-on so the recruiter has something to fill
    // in rather than an empty section. Both setState calls happen here in
    // the event handler rather than inside an updater, so StrictMode's
    // double-invoked updaters cannot seed the rows twice.
    if (next && installments.length === 0) {
      setInstallments([
        newInstallmentRow(dueDateIso || issueDate),
        newInstallmentRow(dueDateIso || issueDate),
      ]);
    }
    setUseInstallments(next);
  }

  function updateInstallment(key: string, patch: Partial<InstallmentRow>) {
    setInstallments((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function removeInstallment(key: string) {
    setInstallments((rows) => rows.filter((r) => r.key !== key));
  }

  async function onSave() {
    if (saving) return;
    setError(null);

    // Client-side guards mirror the server action's messages so the
    // recruiter sees the same wording either way.
    if (!clientId) return setError("Pick a client.");
    if (!jobId) return setError("Pick a job.");
    if (totalDollars <= 0) {
      return setError("Enter a retainer amount greater than zero.");
    }
    const days = Number(guaranteeDays);
    if (!Number.isFinite(days) || !Number.isInteger(days) || days <= 0) {
      return setError("Enter a guarantee period of at least one day.");
    }
    if (useInstallments) {
      if (installments.length === 0) {
        return setError(
          "Add at least one installment, or turn off split payments.",
        );
      }
      if (!installmentsMatch) {
        return setError(
          `Installments add up to ${USD.format(installmentSum)}, but the retainer is ${USD.format(
            totalDollars,
          )}. Adjust them to match.`,
        );
      }
    }

    setSaving(true);
    try {
      const res = await createRetainedSearch({
        clientId,
        jobId,
        totalAmount: totalDollars,
        paymentTerms,
        guaranteeDays: days,
        useInstallments,
        installments: useInstallments
          ? installments.map((r) => ({
              amount: digitsToDollars(r.amount),
              dueDate: r.dueDate,
            }))
          : undefined,
      });
      if (!res.ok) {
        setError(res.error);
        setSaving(false);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Something went wrong saving the retained search.");
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send retained invoice"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            Send Retained Invoice
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label="Close"
            className="p-1 shadow-none"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <Select
            label="Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Select a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <div>
            <Select
              label="Job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              disabled={!clientId}
            >
              <option value="">
                {clientId ? "Select a job" : "Pick a client first"}
              </option>
              {jobsForClient.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Select>
            {clientId && jobsForClient.length === 0 && (
              <p className={HINT_CLASS}>
                This client has no jobs yet.{" "}
                <Link
                  href={`/jobs/new?clientId=${clientId}`}
                  className="font-semibold text-court-brand-dark underline"
                >
                  Create one
                </Link>
                , then reopen this form.
              </p>
            )}
            {clientId && jobsForClient.length > 0 && (
              <p className={HINT_CLASS}>
                Job not listed?{" "}
                <Link
                  href={`/jobs/new?clientId=${clientId}`}
                  className="font-semibold text-court-brand-dark underline"
                >
                  Create a job
                </Link>
                .
              </p>
            )}
          </div>

          <div>
            <span className={SECTION_LABEL_CLASS}>Total retainer amount</span>
            <div className="court-input-frame court-input-rect w-full">
              <MaskedCurrencyInput
                value={totalDigits}
                onChange={setTotalDigits}
                placeholder="$0"
                aria-label="Total retainer amount"
                className="court-input-control text-sm tabular-nums"
              />
            </div>
          </div>

          <Select
            label="Payment terms"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
          >
            {PAYMENT_TERMS_OPTIONS.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </Select>

          <div>
            <span className={SECTION_LABEL_CLASS}>Due date</span>
            <div className="court-input-frame court-input-rect w-full opacity-70">
              <input
                type="text"
                readOnly
                aria-label="Due date"
                value={dueDateIso || "—"}
                className="court-input-control text-sm tabular-nums"
              />
            </div>
            <p className={HINT_CLASS}>
              Calculated from today and the selected terms. Updates as the
              terms change.
            </p>
          </div>

          <div className="rounded-lg border border-court-border-soft p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-court-fg">
                Split into installments
              </div>
              <Button
                variant="ghost"
                role="switch"
                aria-checked={useInstallments}
                aria-label="Split into installments"
                onClick={toggleInstallments}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full p-0 shadow-none transition-colors",
                  useInstallments ? "bg-court-brand" : "bg-court-border",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    useInstallments ? "translate-x-[22px]" : "translate-x-0.5",
                  )}
                />
              </Button>
            </div>

            {useInstallments && (
              <div className="mt-4 flex flex-col gap-3">
                {installments.map((row, i) => (
                  <div key={row.key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={SECTION_LABEL_CLASS}>
                        {`Installment ${i + 1} amount`}
                      </span>
                      <div className="court-input-frame court-input-rect w-full">
                        <MaskedCurrencyInput
                          value={row.amount}
                          onChange={(digits) =>
                            updateInstallment(row.key, { amount: digits })
                          }
                          placeholder="$0"
                          aria-label={`Installment ${i + 1} amount`}
                          className="court-input-control text-sm tabular-nums"
                        />
                      </div>
                    </div>
                    <Input
                      label="Due date"
                      type="date"
                      containerClassName="min-w-0 flex-1"
                      value={row.dueDate}
                      onChange={(e) =>
                        updateInstallment(row.key, { dueDate: e.target.value })
                      }
                      aria-label={`Installment ${i + 1} due date`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeInstallment(row.key)}
                      aria-label={`Remove installment ${i + 1}`}
                      className="mb-1 p-1 shadow-none"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setInstallments((rows) => [
                        ...rows,
                        newInstallmentRow(dueDateIso || issueDate),
                      ])
                    }
                  >
                    <Plus className="h-3 w-3" />
                    Add installment
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-court-border-soft pt-3 text-sm">
                  <span className="text-court-fg-muted">Installment total</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      installmentsMatch
                        ? "text-court-fg"
                        : "text-red-700",
                    )}
                  >
                    {formatCurrency(String(installmentSum)) || "$0"}
                    <span className="text-court-fg-muted">
                      {" of "}
                      {formatCurrency(totalDigits) || "$0"}
                    </span>
                  </span>
                </div>

                {showInstallmentWarning && (
                  <p className="text-[11px] font-medium text-red-700">
                    {`Installments add up to ${USD.format(installmentSum)}, but the retainer is ${USD.format(totalDollars)}. Adjust them to match before saving.`}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Input
              label="Guarantee period in days"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={guaranteeDays}
              onChange={(e) => setGuaranteeDays(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
            <p className={HINT_CLASS}>
              Clock starts on the candidate&apos;s start date, not today.
            </p>
          </div>

          {error && (
            <p className="text-[11px] font-medium text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving}
              className="w-auto"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
