"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useComposerManager } from "@/lib/composer-manager";
import type { AttachmentDraft } from "@/app/mail/mail-composer";

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
  const composer = useComposerManager();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftingEmail, setDraftingEmail] = useState(false);

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

  async function handleEmailDraft() {
    if (draftingEmail) return;
    setError(null);
    setDraftingEmail(true);
    try {
      const lastName = props.candidateName
        ? (props.candidateName.split(" ").slice(-1)[0] ?? "placement")
        : "placement";
      const firstName = billingPrimary?.name?.split(" ")[0] ?? "team";
      const startLabel = startDate ? new Date(startDate).toLocaleDateString() : "TBD";
      const dueLabel = dueDate ? new Date(dueDate).toLocaleDateString() : "TBD";
      const signer = props.accountExecName || "Andrew";
      const subject = `Invoice from ${props.billingCompanyName} - ${lastName} placement (${props.invoiceNumber})`;
      const paragraphs = [
        `Hi ${firstName},`,
        `Congratulations again on bringing ${props.candidateName || "your new hire"} onto the team${props.roleTitle ? ` as ${props.roleTitle}` : ""}.`,
        `Attached is invoice ${props.invoiceNumber} for the placement fee of ${formatUsd(feeAmount)}, with a start date of ${startLabel}. Payment is due ${dueLabel}.`,
        `ACH, wire, and check details are inside the PDF. Please reference ${props.invoiceNumber} on payment. If anything looks off or you need a different billing contact on file, just reply here and we'll sort it out.`,
        `We appreciate you trusting ${props.billingCompanyName} with this search, and we hope to continue to support your hiring needs in the future.`,
        `Best,<br />${signer}`,
      ];
      const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
      const to = billingPrimary?.email ?? "";
      const cc = hiringContacts.map((c) => c.email).filter(Boolean).join(", ");

      // Fetch the rendered invoice PDF and attach as a base64 draft so
      // the recruiter doesn't have to re-attach by hand. The composer
      // accepts AttachmentDraft[] via defaultAttachments and surfaces
      // them in the attachments row exactly as if the user had dragged
      // the file in.
      let attachments: AttachmentDraft[] = [];
      try {
        const res = await fetch(`/invoices/${props.id}/pdf`, { cache: "no-store" });
        if (res.ok) {
          const blob = await res.blob();
          const dataBase64 = await blobToBase64(blob);
          attachments = [
            {
              key: `inv-${props.id}-${Date.now()}`,
              filename: `${props.billingCompanyName} - ${props.invoiceNumber}.pdf`,
              mimeType: "application/pdf",
              sizeBytes: blob.size,
              dataBase64,
            },
          ];
        } else {
          setError(`Couldn't attach PDF (status ${res.status}). You can attach it manually.`);
        }
      } catch (err) {
        setError(
          `Couldn't attach PDF: ${err instanceof Error ? err.message : "fetch failed"}. You can attach it manually.`,
        );
      }

      const init = await fetch("/api/mail/compose-init", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      composer.open({
        defaultTo: to,
        defaultCc: cc,
        defaultSubject: subject,
        defaultBody: body,
        defaultAttachments: attachments,
        templates: init?.templates ?? [],
        mergeContext: {
          user: {
            firstName: init?.user?.firstName ?? "",
            fullName: init?.user?.fullName ?? "",
          },
        },
        modalTitle: "Draft invoice email",
        nonBlocking: true,
      });
    } finally {
      setDraftingEmail(false);
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
              className="rounded-full border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSend}
              className="rounded-full bg-court-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-surface shadow-sm hover:bg-court-brand-dark disabled:opacity-60"
            >
              Mark as sent
            </button>
            <button
              type="button"
              disabled={isPending || draftingEmail}
              onClick={handleEmailDraft}
              className="rounded-full border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
            >
              {draftingEmail ? "Opening…" : "Draft Email"}
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
              className="ml-auto rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-60"
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
                className="rounded-full bg-court-fg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-surface shadow-sm hover:bg-court-brand-dark disabled:opacity-60"
              >
                Mark as paid
              </button>
            ) : null}
            {props.status !== "VOID" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction(() => restoreInvoiceDraftAction(props.id))}
                className="rounded-full border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
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
                className="ml-auto rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-60"
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
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
