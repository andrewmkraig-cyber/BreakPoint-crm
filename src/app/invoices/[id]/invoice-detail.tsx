"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";

import { useComposerManager } from "@/lib/composer-manager";
import type { AttachmentDraft } from "@/app/mail/mail-composer";

import {
  createDraftInvoiceAction,
  deleteInvoiceAction,
  markInvoicePaidAction,
  markInvoiceSentAction,
  markInvoiceVoidAction,
  restoreInvoiceDraftAction,
  updateInvoiceAction,
  updateInvoiceSendFromAliasAction,
} from "../actions";

type SendAsAlias = {
  sendAsEmail: string;
  displayName: string;
  isDefault: boolean;
};

type Contact = { name: string; email: string; title?: string };

const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "rounded-full bg-court-surface-subtle text-court-fg" },
  SENT: { label: "Sent", tone: "rounded-full bg-amber-50 text-amber-800 border border-amber-200" },
  PAID: { label: "Paid", tone: "rounded-md border border-court-brand bg-transparent text-court-brand" },
  VOID: { label: "Void", tone: "rounded-full bg-slate-100 text-slate-500 border border-slate-200" },
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

export type InvoicePaymentMethod = "CHECK" | "ACH" | "CREDIT";

const PAYMENT_METHOD_LABEL: Record<InvoicePaymentMethod, string> = {
  CHECK: "Check",
  ACH: "ACH",
  CREDIT: "Credit",
};

export type InvoiceDetailProps = {
  // Null = unsaved "new invoice" mode. No DB row exists yet; it is created
  // only when the user clicks Save draft / Mark as sent. Every server action
  // that needs a persisted row is gated on this being non-null.
  id: string | null;
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
  paymentMethod: InvoicePaymentMethod | null;
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
  // Persisted "Send mail as" alias for this invoice's outgoing email.
  // Null = no override; the panel defaults to billingArEmail (when it's
  // a verified alias on the Gmail account) and ultimately to the Gmail
  // primary if even that's missing.
  sendFromAlias: string | null;
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
  // Recruiter selects how the client paid before flipping the invoice
  // to PAID. Null until picked; the Mark-as-paid button stays disabled
  // until it's set so we never write a PAID row without an attribution.
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod | "">(
    props.paymentMethod ?? "",
  );

  // Gmail "Send mail as" aliases. Powers the From dropdown in the
  // "Sent from" panel. Empty until /api/mail/send-as-aliases returns —
  // we render a single-line "Loading aliases…" hint during that window
  // so the dropdown doesn't pop in late and shift the panel.
  const [sendAsAliases, setSendAsAliases] = useState<SendAsAlias[]>([]);
  const [aliasesLoaded, setAliasesLoaded] = useState(false);
  // The currently-selected alias for this invoice. Initially mirrors
  // props.sendFromAlias; once aliases load, we promote billingArEmail
  // to the default when the invoice has no persisted choice AND the
  // billing AR address is actually a verified alias on the user's
  // Gmail account. Falls back to Gmail's isDefault otherwise.
  const [selectedFromAlias, setSelectedFromAlias] = useState<string | null>(
    props.sendFromAlias,
  );
  const [aliasSaving, setAliasSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mail/send-as-aliases", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setAliasesLoaded(true);
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { aliases?: SendAsAlias[] }
          | null;
        if (cancelled || !body?.aliases) {
          if (!cancelled) setAliasesLoaded(true);
          return;
        }
        setSendAsAliases(body.aliases);
        setAliasesLoaded(true);
        setSelectedFromAlias((prev) => {
          if (prev) return prev;
          const arMatch = body.aliases!.find(
            (a) => a.sendAsEmail.toLowerCase() === props.billingArEmail.toLowerCase(),
          );
          if (arMatch) return arMatch.sendAsEmail;
          const def = body.aliases!.find((a) => a.isDefault);
          return def?.sendAsEmail ?? body.aliases![0]?.sendAsEmail ?? null;
        });
      } catch {
        if (!cancelled) setAliasesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.billingArEmail]);

  function onPickAlias(next: string) {
    setSelectedFromAlias(next);
    // In new mode there's no row to persist to yet — the choice rides along
    // in createDraftInvoiceAction when the invoice is first saved.
    if (props.id === null) return;
    setAliasSaving(true);
    void updateInvoiceSendFromAliasAction(props.id, next)
      .then((r) => {
        if (!r.ok) setError(r.error);
      })
      .finally(() => setAliasSaving(false));
  }

  const isDraft = props.status === "DRAFT";
  // Unsaved "new invoice" mode — no row exists yet.
  const isNew = props.id === null;
  const statusPill = STATUS_PILL[props.status] ?? { label: props.status, tone: "rounded-full" };
  const billingPrimary = billingContacts[0];

  // Persists the editor. In new mode this CREATES the draft row (the first
  // and only write for a brand-new invoice); in edit mode it updates the
  // existing row. The continuation receives the effective invoice id so
  // callers (e.g. Mark as sent) can act on the freshly-created row.
  function save(then?: (invoiceId: string) => void | Promise<void>) {
    setError(null);
    startTransition(async () => {
      if (props.id === null) {
        const result = await createDraftInvoiceAction({
          roleTitle,
          startDate: startDate || null,
          dueDate: dueDate || null,
          feeAmount,
          paymentTerms,
          notes,
          billingContacts,
          hiringContacts,
          candidateId: props.candidateId,
          clientId: props.clientId,
          sendFromAlias: selectedFromAlias,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (then) {
          await then(result.data.id);
        } else {
          router.push(`/invoices/${result.data.id}`);
        }
        return;
      }
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
      if (then) await then(props.id);
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
    save(async (invoiceId) => {
      const result = await markInvoiceSentAction(invoiceId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // New invoice: we're on /invoices/new, so route to the saved row.
      // Existing invoice: stay put and refresh the server data.
      if (props.id === null) router.push(`/invoices/${invoiceId}`);
      else router.refresh();
    });
  }

  async function handleEmailDraft() {
    if (draftingEmail) return;
    // Drafting the email pulls the rendered PDF from /invoices/[id]/pdf, so
    // it requires a saved row. The button is hidden in new mode; this guard
    // keeps the id non-null for the rest of the handler.
    if (props.id === null) return;
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
      // Suppress the "of $X" clause when the fee isn't captured so we
      // don't ship a "for the placement fee of —" sentence. formatUsd
      // returns an em dash for missing/zero amounts; the clause comes
      // out entirely in that case.
      const feeLabel = formatUsd(feeAmount);
      const feeOfClause = feeLabel === "—" ? "" : ` of ${feeLabel}`;
      const paragraphs = [
        `Hi ${firstName},`,
        `Congratulations again on bringing ${props.candidateName || "your new hire"} onto the team${props.roleTitle ? ` as ${props.roleTitle}` : ""}.`,
        `Attached is invoice ${props.invoiceNumber} for the placement fee${feeOfClause}, with a start date of ${startLabel}. Payment is due ${dueLabel}.`,
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
        // Honor the invoice's persisted "Sent from" selection so the
        // Gmail send actually goes out from AR@ (or whichever alias the
        // recruiter picked). The composer falls back to its own default
        // selection when this is null.
        defaultSendAsEmail: selectedFromAlias,
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
              "inline-flex items-center px-3 py-1 text-[11px] font-semibold uppercase tracking-wider " +
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
              className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60 dark:border-court-border dark:text-court-fg-muted"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSend}
              className="rounded-md border border-court-brand bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-brand shadow-sm hover:bg-court-brand/10 disabled:opacity-60"
            >
              Mark as sent
            </button>
            {!isNew ? (
              <button
                type="button"
                disabled={isPending || draftingEmail}
                onClick={handleEmailDraft}
                className="rounded-md border border-blue-500 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-600 shadow-sm hover:bg-blue-500/10 disabled:opacity-60 dark:text-blue-400"
              >
                {draftingEmail ? "Opening…" : "Draft Email"}
              </button>
            ) : null}
            {isNew ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => router.push("/invoices")}
                className="ml-auto rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const id = props.id;
                  if (!id) return;
                  if (!confirm("Delete this draft? This cannot be undone.")) return;
                  runAction(async () => {
                    const r = await deleteInvoiceAction(id);
                    if (r.ok) router.push("/invoices");
                    return r;
                  });
                }}
                className="ml-auto rounded-md border border-red-500 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
              >
                Delete draft
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-court-border pt-5">
            {props.status === "SENT" ? (
              <>
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  Payment method
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as InvoicePaymentMethod | "")
                    }
                    disabled={isPending}
                    className="rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-court-fg shadow-sm focus:border-court-accent focus:outline-none"
                  >
                    <option value="">Select…</option>
                    <option value="CHECK">Check</option>
                    <option value="ACH">ACH</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={isPending || !paymentMethod}
                  onClick={() => {
                    const id = props.id;
                    if (!id) return;
                    if (!paymentMethod) {
                      setError("Pick a payment method before marking paid.");
                      return;
                    }
                    runAction(() =>
                      markInvoicePaidAction(id, paymentMethod as InvoicePaymentMethod),
                    );
                  }}
                  className="rounded-md border border-court-brand bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-brand shadow-sm hover:bg-court-brand/10 disabled:opacity-60"
                >
                  Mark as paid
                </button>
              </>
            ) : null}
            {props.status !== "VOID" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const id = props.id;
                  if (!id) return;
                  runAction(() => restoreInvoiceDraftAction(id));
                }}
                className="rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle disabled:opacity-60"
              >
                Restore to draft
              </button>
            ) : null}
            {props.status !== "VOID" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const id = props.id;
                  if (!id) return;
                  if (!confirm("Void this invoice? It stays on file but won't count toward outstanding.")) return;
                  runAction(() => markInvoiceVoidAction(id));
                }}
                className="ml-auto rounded-md border border-red-500 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
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
            <div className="col-span-2">
              <dt className="font-semibold uppercase tracking-wider text-court-fg-muted">
                Payment method
              </dt>
              <dd className="mt-1 text-court-fg">
                {props.paymentMethod ? PAYMENT_METHOD_LABEL[props.paymentMethod] : "—"}
              </dd>
            </div>
          </dl>
        </div>

        {!isNew ? (
          <a
            href={`/invoices/${props.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-court-border bg-court-surface px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm hover:bg-court-surface-subtle"
          >
            Open invoice PDF
          </a>
        ) : null}

        <div className="rounded-2xl border border-court-border bg-court-surface-subtle/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
            Sent from
          </p>
          {sendAsAliases.length > 1 ? (
            <div className="relative mt-2">
              <select
                value={selectedFromAlias ?? ""}
                onChange={(e) => onPickAlias(e.target.value)}
                disabled={aliasSaving}
                className="h-8 w-full appearance-none truncate rounded-md border border-court-border bg-court-surface py-1 pl-2 pr-8 text-sm font-semibold text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
              >
                {sendAsAliases.map((a) => (
                  <option key={a.sendAsEmail} value={a.sendAsEmail}>
                    {a.displayName
                      ? `${a.displayName} <${a.sendAsEmail}>`
                      : a.sendAsEmail}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted"
              />
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-court-fg">Accounts Receivable</p>
              <p className="text-[12px] text-court-fg-muted">
                {selectedFromAlias ?? props.billingArEmail}
              </p>
              {aliasesLoaded && sendAsAliases.length <= 1 && (
                <p className="mt-1 text-[11px] text-court-fg-muted">
                  Add a second &ldquo;Send mail as&rdquo; alias in your Gmail Settings to switch addresses.
                </p>
              )}
            </>
          )}
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
                  className="rounded-md border border-court-border bg-court-surface px-2 text-[11px] font-semibold text-court-fg-muted hover:bg-court-surface-subtle"
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
