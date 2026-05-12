"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteInvoiceAction,
  markInvoicePaidAction,
  markInvoiceSentAction,
  markInvoiceVoidAction,
  restoreInvoiceDraftAction,
  updateInvoiceAction,
} from "../actions";

type Contact = { name: string; email: string; title?: string };

const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "bg-court-surface-subtle text-court-fg" },
  SENT: { label: "Sent", tone: "bg-amber-50 text-amber-800 border border-amber-200" },
  PAID: { label: "Paid", tone: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  VOID: { label: "Void", tone: "bg-slate-100 text-slate-500 border border-slate-200" },
};

function formatUsd(amount: string): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type InvoiceDetailProps = {
  id: string;
  invoiceNumber: string;
  status: string;
  roleTitle: string;
  startDate: string;
  dueDate: string;
  feeAmount: string;
  paymentTerms: string;
  notes: string;
  sentAt: string | null;
  paidAt: string | null;
  candidateName: string;
  candidateId: string | null;
  candidateEmail: string | null;
  clientName: string;
  clientId: string | null;
  accountExecName: string;
  baseSalary: number | null;
  feePercentage: number | null;
  billingContacts: Contact[];
  hiringContacts: Contact[];
  billingCompanyName: string;
  billingArEmail: string;
  billingDisplayAddress: string;
};

export function InvoiceDetail(props: InvoiceDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [roleTitle, setRoleTitle] = useState(props.roleTitle);
  const [startDate, setStartDate] = useState(props.startDate);
  const [dueDate, setDueDate] = useState(props.dueDate);
  const [feeAmount, setFeeAmount] = useState(props.feeAmount);
  const [paymentTerms, setPaymentTerms] = useState(props.paymentTerms);
  const [notes, setNotes] = useState(props.notes);
  const [billingContacts, setBillingContacts] = useState<Contact[]>(props.billingContacts);
  const [hiringContacts, setHiringContacts] = useState<Contact[]>(props.hiringContacts);

  const isDraft = props.status === "DRAFT";
  const statusPill = STATUS_PILL[props.status] ?? { label: props.status, tone: "" };
  const billingPrimary = billingContacts[0];

  function save(then?: () => void | Promise<void>) {
    setError(null);
    startTransition(async () => {
      const result = await updateInvoiceAction({
        id: props.id,
        roleTitle,
        startDate: startDate || null,
        dueDate: dueDate || null,
        feeAmount,
        paymentTerms,
        notes,
        billingContacts,
        hiringContacts,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (then) await then();
    });
  }

  function runAction(fn: () => Promise<{ ok: true; data: void } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleSend() {
    save(async () => {
      const result = await markInvoiceSentAction(props.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleEmailDraft() {
    const subject = encodeURIComponent(
      `Invoice from ${props.billingCompanyName} — ${props.candidateName ? props.candidateName.split(" ").slice(-1)[0] : "placement"} (${props.invoiceNumber})`,
    );
    const firstName = billingPrimary?.name?.split(" ")[0] ?? "team";
    const pdfUrl = typeof window !== "undefined" ? `${window.location.origin}/invoices/${props.id}/pdf` : "";
    const lines = [
      `Hi ${firstName},`,
      "",
      `Congratulations again on bringing ${props.candidateName || "your new hire"} onto the team${props.roleTitle ? ` as ${props.roleTitle}` : ""}. We're glad to have helped, and we're looking forward to seeing the impact.`,
      "",
      `Attached is invoice ${props.invoiceNumber} for the placement fee of ${formatUsd(feeAmount)}, with a start date of ${startDate ? new Date(startDate).toLocaleDateString() : "TBD"}. Payment is due ${dueDate ? new Date(dueDate).toLocaleDateString() : "TBD"} (${paymentTerms}).`,
      "",
      `ACH, wire, and check details are inside the PDF — please reference ${props.invoiceNumber} on payment. If anything looks off or you need a different billing contact on file, just reply here and we'll sort it.`,
      "",
      `Thanks again for trusting ${props.billingCompanyName} with this search.`,
      "",
      "Best,",
      props.accountExecName || "BreakPoint Talent",
      "",
      `PDF: ${pdfUrl}`,
    ];
    const body = encodeURIComponent(lines.join("\n"));
    const to = encodeURIComponent(billingPrimary?.email ?? "");
    const cc = hiringContacts
      .map((c) => c.email)
      .filter(Boolean)
      .concat([props.billingArEmail])
      .join(",");
    const ccParam = cc ? `&cc=${encodeURIComponent(cc)}` : "";
    if (typeof window !== "undefined") {
      window.open(`mailto:${to}?subject=${subject}${ccParam}&body=${body}`, "_blank");
    }
  }

  function addContact(setter: typeof setBillingContacts) {
    setter((prev) => [...prev, { name: "", email: "" }]);
  }

  function updateContact(
    setter: typeof setBillingContacts,
    index: number,
    field: keyof Contact,
    value: string,
  ) {
    setter((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function removeContact(setter: typeof setBillingContacts, index: number) {
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm">
        <header className="flex flex-col gap-3 border-b border-court-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
              {props.invoiceNumber}
            </p>
            <h1 className="mt-1 font-serif text-3xl font-bold tracking-tight text-court-fg">
              {props.clientName || "—"}
            </h1>
            <p className="mt-1 text-sm text-court-fg-muted">
              {props.candidateName || "—"}
              {props.roleTitle ? ` · ${props.roleTitle}` : ""}
            </p>
          </div>
          <span
            className={
              "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider " +
              statusPill.tone
            }
          >
            {statusPill.label}
          </span>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Role title">
            <input
              type="text"
              disabled={!isDraft}
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Fee amount (USD)">
            <input
              type="text"
              inputMode="decimal"
              disabled={!isDraft}
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              placeholder="0.00"
              className={inputCls + " tabular-nums"}
            />
          </Field>
          <Field label="Start date / issue date">
            <input
              type="date"
              disabled={!isDraft}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              disabled={!isDraft}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Payment terms">
            <input
              type="text"
              disabled={!isDraft}
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="Net 30"
              className={inputCls}
            />
          </Field>
          <Field label="Internal notes">
            <input
              type="text"
              disabled={!isDraft}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <ContactSection
          title="Billing contacts (To)"
          contacts={billingContacts}
          disabled={!isDraft}
          onAdd={() => addContact(setBillingContacts)}
          onChange={(i, f, v) => updateContact(setBillingContacts, i, f, v)}
          onRemove={(i) => removeContact(setBillingContacts, i)}
        />
        <ContactSection
          title="Hiring contacts (CC)"
          contacts={hiringContacts}
          disabled={!isDraft}
          onAdd={() => addContact(setHiringContacts)}
          onChange={(i, f, v) => updateContact(setHiringContacts, i, f, v)}
          onRemove={(i) => removeContact(setHiringContacts, i)}
        />

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        ) : null}

        {isDraft ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-court-border pt-5">
            <button
              type="button"
              disabled={isPending}
              onClick={() => save()}
              className="rounded-full border border-court-border bg-court-surface px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSend}
              className="rounded-full bg-court-fg px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-surface shadow-sm hover:bg-court-brand-dark disabled:opacity-60"
            >
              Mark as sent
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleEmailDraft}
              className="rounded-full border border-court-border bg-court-surface px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
            >
              Draft email in Gmail
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!confirm("Delete this draft? This cannot be undone.")) return;
                runAction(async () => {
                  const r = await deleteInvoiceAction(props.id);
                  if (r.ok) router.push("/invoices");
                  return r;
                });
              }}
              className="ml-auto rounded-full border border-red-200 bg-red-50 px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              Delete draft
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-court-border pt-5">
            {props.status === "SENT" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction(() => markInvoicePaidAction(props.id))}
                className="rounded-full bg-court-fg px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-surface shadow-sm hover:bg-court-brand-dark disabled:opacity-60"
              >
                Mark as paid
              </button>
            ) : null}
            {props.status !== "VOID" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction(() => restoreInvoiceDraftAction(props.id))}
                className="rounded-full border border-court-border bg-court-surface px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
              >
                Restore to draft
              </button>
            ) : null}
            {props.status !== "VOID" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirm("Void this invoice? It stays on file but won't count toward outstanding.")) return;
                  runAction(() => markInvoiceVoidAction(props.id));
                }}
                className="ml-auto rounded-full border border-red-200 bg-red-50 px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                Void
              </button>
            ) : null}
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-5">
        <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
            Amount due
          </p>
          <div className="mt-1 font-serif text-3xl font-extrabold tabular-nums text-court-fg">
            {formatUsd(feeAmount)}
          </div>
          <p className="mt-2 text-[11px] text-court-fg-muted">{paymentTerms}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <dt className="font-semibold uppercase tracking-wider text-court-fg-muted">Issued</dt>
              <dd className="mt-1 text-court-fg">{startDate ? new Date(startDate).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold uppercase tracking-wider text-court-fg-muted">Due</dt>
              <dd className="mt-1 text-court-fg">{dueDate ? new Date(dueDate).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold uppercase tracking-wider text-court-fg-muted">Sent</dt>
              <dd className="mt-1 text-court-fg">
                {props.sentAt ? new Date(props.sentAt).toLocaleDateString() : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold uppercase tracking-wider text-court-fg-muted">Paid</dt>
              <dd className="mt-1 text-court-fg">
                {props.paidAt ? new Date(props.paidAt).toLocaleDateString() : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <a
          href={`/invoices/${props.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-court-border bg-court-surface px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle"
        >
          Open invoice PDF
        </a>

        <div className="rounded-2xl border border-court-border bg-court-surface-subtle/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
            Sent from
          </p>
          <p className="mt-1 text-sm font-semibold text-court-fg">Accounts Receivable</p>
          <p className="text-[12px] text-court-fg-muted">{props.billingArEmail}</p>
          <p className="mt-3 text-[11px] text-court-fg-muted">
            Bank details + payment instructions are baked into the PDF. No pay links, no Mercury sync. Configure them in{" "}
            <a href="/settings/billing" className="font-semibold text-court-brand-dark hover:underline">
              Settings → Billing
            </a>
            .
          </p>
        </div>
      </aside>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg shadow-sm focus:border-court-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-court-surface-subtle/60 disabled:text-court-fg-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ContactSection({
  title,
  contacts,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string;
  contacts: Contact[];
  disabled: boolean;
  onAdd: () => void;
  onChange: (i: number, field: keyof Contact, value: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <section className="mt-6 border-t border-court-border pt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          {title}
        </h3>
        {!disabled ? (
          <button
            type="button"
            onClick={onAdd}
            className="text-[11px] font-semibold uppercase tracking-wider text-court-brand-dark hover:underline"
          >
            + Add
          </button>
        ) : null}
      </div>
      {contacts.length === 0 ? (
        <p className="mt-2 text-[12px] text-court-fg-muted">No contacts yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {contacts.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                type="text"
                disabled={disabled}
                placeholder="Name"
                value={c.name}
                onChange={(e) => onChange(i, "name", e.target.value)}
                className={inputCls}
              />
              <input
                type="email"
                disabled={disabled}
                placeholder="email@company.com"
                value={c.email}
                onChange={(e) => onChange(i, "email", e.target.value)}
                className={inputCls}
              />
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="rounded-full border border-court-border bg-court-surface px-2 text-[11px] font-semibold text-court-fg-muted hover:bg-court-surface-subtle"
                  aria-label="Remove contact"
                >
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
