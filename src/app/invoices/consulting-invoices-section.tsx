"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { KpiTile } from "@/app/dashboard/kpi-tile";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { MaskedCurrencyInput } from "@/components/ui/masked-currency-input";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  CONSULTING_COMPANIES,
  CONSULTING_COMPANY_KEYS,
  type ConsultingCompanyKey,
  type ConsultingInvoiceRow,
  formatConsultingDateShort,
  formatConsultingInvoiceNumber,
  formatConsultingUsd,
  shiftIsoDate,
} from "@/lib/consulting-invoices-shared";
import {
  createConsultingInvoice,
  deleteConsultingInvoice,
  updateConsultingInvoice,
} from "@/app/invoices/consulting-invoice-actions";

// The Consulting Invoices section on /invoices: two tally tiles, the
// Generate Consulting Invoice button + its modal, and the filterable
// history table with Edit / Delete on every row. The rows come down from
// the server page already serialized (amount as a number, dates as
// YYYY-MM-DD) so this file never touches prisma or Decimal.
//
// Edit reuses the Generate modal (`existing` = edit mode): company and
// number are locked, the fields pre-fill, and a "Resend" toggle emails the
// corrected PDF after the row saves. Delete keeps a confirm (ACE_RULES:
// destructive actions always keep one), rendered as a red banner row
// directly under the invoice, the same pattern as the client delete.

type CompanyFilter = "all" | ConsultingCompanyKey;

const FILTERS: Array<{ id: CompanyFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "arfie", label: CONSULTING_COMPANIES.arfie.shortName },
  { id: "branzino", label: CONSULTING_COMPANIES.branzino.shortName },
];

const SECTION_LABEL_CLASS = "mb-1 block text-xs uppercase tracking-wide text-court-fg-muted";
const HINT_CLASS = "mt-1 text-[11px] text-court-fg-muted";

// Default service period for a Branzino invoice: the two weeks ending on
// the invoice date. Editable; the recruiter sees it before saving.
const DEFAULT_SERVICE_PERIOD_DAYS = 14;

function todayIso(): string {
  // Local calendar day as the YYYY-MM-DD an <input type="date"> speaks,
  // the same way the retained-search modal seeds its issue date.
  const now = new Date();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function digitsToDollars(digits: string): number {
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function ConsultingInvoicesSection({
  invoices,
  totalsCents,
}: {
  invoices: ConsultingInvoiceRow[];
  totalsCents: Record<ConsultingCompanyKey, number>;
}) {
  const [filter, setFilter] = useState<CompanyFilter>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConsultingInvoiceRow | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? invoices : invoices.filter((r) => r.company === filter)),
    [filter, invoices],
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
        CONSULTING FEES
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CONSULTING_COMPANY_KEYS.map((key) => {
          const co = CONSULTING_COMPANIES[key];
          return (
            <KpiTile
              key={key}
              label={`${co.ownerName} (${co.shortName})`}
              value={formatConsultingUsd(totalsCents[key] / 100)}
              icon={Briefcase}
              live={totalsCents[key] > 0}
              sub="Total consulting fees"
            />
          );
        })}
      </div>

      <div className="rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-3 border-b border-court-border p-6 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
              Consulting Invoices
            </p>
            <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-court-fg">
              {filter === "all" ? "All consulting invoices" : `${CONSULTING_COMPANIES[filter].name} invoices`}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TabStrip<CompanyFilter>
              ariaLabel="Consulting invoice company filter"
              activeId={filter}
              onChange={setFilter}
              items={FILTERS.map((f) => ({
                id: f.id,
                label: f.label,
                count: f.id === "all" ? invoices.length : invoices.filter((r) => r.company === f.id).length,
              }))}
            />
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Generate Consulting Invoice
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-court-border bg-court-surface-subtle/50">
                {["Invoice", "Company", "Amount", "Invoice Date", "Due Date", ""].map((h, i) => (
                  <th
                    key={h || `col-${i}`}
                    className="px-6 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-14 text-center text-[13px] text-court-fg-muted">
                    No consulting invoices yet.
                  </td>
                </tr>
              ) : (
                visible.map((inv) => (
                  <ConsultingInvoiceTableRow
                    key={inv.id}
                    inv={inv}
                    confirmingDelete={confirmingDeleteId === inv.id}
                    onEdit={() => setEditing(inv)}
                    onAskDelete={() => setConfirmingDeleteId(inv.id)}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open ? <ConsultingInvoiceModal onClose={() => setOpen(false)} /> : null}
      {editing ? (
        <ConsultingInvoiceModal existing={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

// One history row plus, while a delete is pending confirmation, a red
// banner row beneath it. The banner is a second <tr> so the table columns
// never shift; the Fragment keys on the invoice id.
function ConsultingInvoiceTableRow({
  inv,
  confirmingDelete,
  onEdit,
  onAskDelete,
  onCancelDelete,
}: {
  inv: ConsultingInvoiceRow;
  confirmingDelete: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const label = `${CONSULTING_COMPANIES[inv.company].name} invoice ${formatConsultingInvoiceNumber(inv.company, inv.invoiceNumber)}`;

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await deleteConsultingInvoice(inv.id);
      if (!res.ok) {
        toast.error(res.error);
        setDeleting(false);
        return;
      }
      toast.success(`${res.companyName} invoice ${res.invoiceNumberLabel} deleted`);
      onCancelDelete();
      router.refresh();
    } catch {
      toast.error("Something went wrong deleting the invoice.");
      setDeleting(false);
    }
  }

  return (
    <>
      <tr className={"border-b border-court-border last:border-b-0" + (confirmingDelete ? " border-b-0" : "")}>
        <td className="px-6 py-3 align-top">
          <span className="font-mono text-[12px] font-semibold text-court-fg">
            {formatConsultingInvoiceNumber(inv.company, inv.invoiceNumber)}
          </span>
        </td>
        <td className="px-6 py-3 align-top">
          <div className="font-medium text-court-fg">{CONSULTING_COMPANIES[inv.company].name}</div>
          <div className="text-[12px] text-court-fg-muted">
            {CONSULTING_COMPANIES[inv.company].ownerName}
          </div>
        </td>
        <td className="px-6 py-3 align-top tabular-nums text-court-fg">
          {formatConsultingUsd(inv.amount)}
        </td>
        <td className="px-6 py-3 align-top text-court-fg-muted">
          {formatConsultingDateShort(inv.invoiceDate)}
        </td>
        <td className="px-6 py-3 align-top text-court-fg-muted">
          {formatConsultingDateShort(inv.dueDate)}
        </td>
        <td className="px-6 py-3 align-top">
          {/* Quiet row actions: muted Edit pencil beside a delete that only
              goes red on hover (ACE_DESIGN icon semantic colors). */}
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              aria-label={`Edit ${label}`}
              title="Edit"
              className="p-1 text-court-fg-muted shadow-none"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onAskDelete}
              aria-label={`Delete ${label}`}
              title="Delete"
              className="p-1 text-court-fg-muted shadow-none hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {confirmingDelete ? (
        <tr className="border-b border-court-border last:border-b-0">
          <td colSpan={6} className="px-6 pb-3 pt-0">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="font-medium">
                Delete {label} for {formatConsultingUsd(inv.amount)}? This cannot be undone. The PDF
                already emailed is not recalled.
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onCancelDelete} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={onDelete} disabled={deleting}>
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// Generate (no `existing`) and Edit (`existing` set) share this modal.
function ConsultingInvoiceModal({
  existing,
  onClose,
}: {
  existing?: ConsultingInvoiceRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = todayIso();
  const isEdit = existing != null;

  const [company, setCompany] = useState<"" | ConsultingCompanyKey>(existing?.company ?? "");
  // MaskedCurrencyInput is digits-only, so a seeded amount is rounded to
  // whole dollars; every consulting invoice to date is whole dollars.
  const [amountDigits, setAmountDigits] = useState(
    existing ? String(Math.round(existing.amount)) : "",
  );
  const [invoiceDate, setInvoiceDate] = useState(existing?.invoiceDate ?? today);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? today);
  // Due date tracks the invoice date until the recruiter edits it directly.
  // An existing row's dates are already the recruiter's, so they never
  // auto-track.
  const [dueTouched, setDueTouched] = useState(isEdit);
  const [periodStart, setPeriodStart] = useState(
    existing?.servicePeriodStart ?? shiftIsoDate(existing?.invoiceDate ?? today, -DEFAULT_SERVICE_PERIOD_DAYS),
  );
  const [periodEnd, setPeriodEnd] = useState(
    existing?.servicePeriodEnd ?? existing?.invoiceDate ?? today,
  );
  const [periodTouched, setPeriodTouched] = useState(isEdit);
  // Edit only: email the corrected PDF after saving. On by default because
  // an edited invoice is almost always a correction the recipients need.
  const [resend, setResend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function onInvoiceDateChange(next: string) {
    setInvoiceDate(next);
    if (!dueTouched) setDueDate(next);
    if (!periodTouched && next) {
      setPeriodStart(shiftIsoDate(next, -DEFAULT_SERVICE_PERIOD_DAYS));
      setPeriodEnd(next);
    }
  }

  const amountDollars = digitsToDollars(amountDigits);
  const isBranzino = company === "branzino";

  async function onSubmit() {
    if (saving) return;
    setError(null);
    if (!company) return setError("Pick a company.");
    if (amountDollars <= 0) return setError("Enter an amount greater than zero.");
    if (!invoiceDate) return setError("Pick an invoice date.");
    if (!dueDate) return setError("Pick a due date.");
    if (dueDate < invoiceDate) return setError("The due date cannot be before the invoice date.");
    if (isBranzino && periodEnd < periodStart) {
      return setError("The service period cannot end before it starts.");
    }

    setSaving(true);
    try {
      const fields = {
        amount: amountDollars,
        invoiceDate,
        dueDate,
        servicePeriodStart: isBranzino ? periodStart : null,
        servicePeriodEnd: isBranzino ? periodEnd : null,
      };
      const res = existing
        ? await updateConsultingInvoice({ id: existing.id, resend, ...fields })
        : await createConsultingInvoice({ company, ...fields });
      if (!res.ok) {
        setError(res.error);
        setSaving(false);
        return;
      }
      const label = `${res.companyName} invoice ${res.invoiceNumberLabel}`;
      if (!res.emailAttempted) {
        toast.success(`${label} saved`);
      } else if (res.emailed) {
        toast.success(`${label} saved and emailed`, {
          description: res.sentFromNote
            ? `Sent to Andrew and Austin. ${res.sentFromNote}`
            : `Sent from ${res.sentFrom} to Andrew and Austin.`,
        });
      } else {
        toast.error(`${label} saved, but the email did not send`, {
          description: res.emailError ?? "Unknown email error",
        });
      }
      onClose();
      router.refresh();
    } catch {
      setError(
        existing
          ? "Something went wrong saving the invoice."
          : "Something went wrong generating the invoice.",
      );
      setSaving(false);
    }
  }

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
        aria-label={isEdit ? "Edit consulting invoice" : "Generate consulting invoice"}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-base font-semibold text-court-fg">
              {isEdit ? "Edit Consulting Invoice" : "Generate Consulting Invoice"}
            </h2>
            {existing ? (
              <p className="mt-0.5 text-[12px] text-court-fg-muted">
                {CONSULTING_COMPANIES[existing.company].name} invoice{" "}
                <span className="font-mono font-semibold text-court-fg">
                  {formatConsultingInvoiceNumber(existing.company, existing.invoiceNumber)}
                </span>
              </p>
            ) : null}
          </div>
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
          {/* Company and number are fixed once issued: the number is a
              per-company sequence. */}
          {isEdit ? null : (
            <Select
              label="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value as "" | ConsultingCompanyKey)}
            >
              <option value="">Select a company</option>
              {CONSULTING_COMPANY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {CONSULTING_COMPANIES[key].name}
                </option>
              ))}
            </Select>
          )}

          <div>
            <span className={SECTION_LABEL_CLASS}>Amount</span>
            <div className="court-input-frame court-input-rect w-full">
              <MaskedCurrencyInput
                value={amountDigits}
                onChange={setAmountDigits}
                placeholder="$0"
                aria-label="Amount"
                className="court-input-control text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Invoice date"
              type="date"
              value={invoiceDate}
              onChange={(e) => onInvoiceDateChange(e.target.value)}
            />
            <div>
              <Input
                label="Due date"
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueTouched(true);
                  setDueDate(e.target.value);
                }}
              />
              <p className={HINT_CLASS}>
                {company
                  ? `Prints as "${CONSULTING_COMPANIES[company].terms}".`
                  : "Defaults to the invoice date. Prints as due upon receipt."}
              </p>
            </div>
          </div>

          {isBranzino ? (
            <div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Service period start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => {
                    setPeriodTouched(true);
                    setPeriodStart(e.target.value);
                  }}
                />
                <Input
                  label="Service period end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => {
                    setPeriodTouched(true);
                    setPeriodEnd(e.target.value);
                  }}
                />
              </div>
              <p className={HINT_CLASS}>
                Prints on the Branzino line item. Defaults to the two weeks ending on the invoice date.
              </p>
            </div>
          ) : null}

          {isEdit ? (
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-court-fg">
              <input
                type="checkbox"
                checked={resend}
                onChange={(e) => setResend(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-court-brand"
              />
              <span>
                Email the corrected PDF to andrew@breakpointtalent.com and austin@breakpointtalent.com
                {company ? `, with ${CONSULTING_COMPANIES[company].ccEmail} on copy` : ""}, marked
                as updated.
              </span>
            </label>
          ) : (
            <p className="text-[11px] text-court-fg-muted">
              The PDF is emailed to andrew@breakpointtalent.com and austin@breakpointtalent.com
              {company ? `, with ${CONSULTING_COMPANIES[company].ccEmail} on copy.` : "."}
            </p>
          )}

          {error && (
            <p className="text-[11px] font-medium text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSubmit}
              disabled={saving}
              className="w-auto"
            >
              {isEdit
                ? saving
                  ? "Saving..."
                  : resend
                    ? "Save and email"
                    : "Save"
                : saving
                  ? "Generating..."
                  : "Generate and email"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
