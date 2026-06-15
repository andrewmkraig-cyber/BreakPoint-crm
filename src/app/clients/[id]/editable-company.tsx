"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatPhone, telHref } from "@/lib/rf-payload-shapes";
import { updateClientCompany } from "@/app/clients/[id]/actions";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const INDUSTRY_OPTIONS = [
  "Accounting",
  "Manufacturing",
  "Food/Beverage",
  "Technology",
  "Legal",
  "Engineering",
  "Healthcare",
  "Financial Services",
  "Other",
] as const;

export type CompanyState = {
  name: string;
  website: string;
  linkedin: string;
  phones: string[];
  industry: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  feeAgreementSigned: boolean;
  feeAgreementSignedAt: string;
  feePct: string;
  feeBillingContact: string;
};

export type BillingContactOption = {
  id: string;
  label: string;
  value: string;
  detail?: string;
};

export function EditableCompany({
  clientCuid,
  initial,
  agreementFile,
  billingContacts = [],
  createContactHref,
  canWrite = true,
}: {
  clientCuid: string;
  initial: CompanyState;
  agreementFile?: { filename: string; link: string } | null;
  billingContacts?: BillingContactOption[];
  createContactHref: string;
  // When false (viewing a client you don't own) the Edit affordance is
  // hidden, so the card renders as a read-only company summary.
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompanyState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onCancel() {
    setDraft(initial);
    setErr(null);
    setEditing(false);
  }

  function onSave() {
    setErr(null);
    startSave(async () => {
      const result = await updateClientCompany({ clientCuid, ...draft });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save client", { description: result.error });
        return;
      }
      toast.success("Client updated");
      setEditing(false);
      router.refresh();
    });
  }

  const addressLines = [
    draft.street1,
    draft.street2,
    formatCityStateZip(draft.city, draft.state, draft.postalCode),
  ].filter(Boolean);
  const websiteHref = draft.website
    ? draft.website.startsWith("http")
      ? draft.website
      : `https://${draft.website}`
    : "";
  const signedOnDisplay = draft.feeAgreementSignedAt
    ? new Date(draft.feeAgreementSignedAt).toLocaleDateString()
    : "";
  const hasSelectedBillingContact = billingContacts.some(
    (contact) => contact.value === draft.feeBillingContact,
  );

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface p-4 shadow-sm lg:col-span-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Company &amp; Fee Agreement
        </h2>
        {!editing && canWrite && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledField
              label="Company name"
              value={draft.name}
              onChange={(v) => setDraft({ ...draft, name: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Website"
              value={draft.website}
              onChange={(v) => setDraft({ ...draft, website: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="LinkedIn"
              value={draft.linkedin}
              onChange={(v) => setDraft({ ...draft, linkedin: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <div className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Phone
              </span>
              <div className="mt-1 space-y-2">
                {(draft.phones.length ? draft.phones : [""]).map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={cn(INPUT_FRAME_RECT_CLASS, "w-full")}>
                      <input
                        value={p}
                        onChange={(e) => {
                          const next = draft.phones.length ? [...draft.phones] : [""];
                          next[i] = e.target.value;
                          setDraft({ ...draft, phones: next });
                        }}
                        className={`${INPUT_CONTROL_CLASS} text-sm`}
                      />
                    </div>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, phones: draft.phones.filter((_, j) => j !== i) })
                        }
                        className="rounded-md p-1 text-court-fg-muted transition hover:text-red-600"
                        aria-label="Remove phone"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      phones: [...(draft.phones.length ? draft.phones : [""]), ""],
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-court-fg-muted transition hover:text-brand-dark"
                >
                  <Plus className="h-3 w-3" /> Add phone
                </button>
              </div>
            </div>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Industry
              </span>
              <select
                value={draft.industry}
                onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
                className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">—</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Address
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledField
              label="Street"
              value={draft.street1}
              onChange={(v) => setDraft({ ...draft, street1: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Street 2"
              value={draft.street2}
              onChange={(v) => setDraft({ ...draft, street2: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="City"
              value={draft.city}
              onChange={(v) => setDraft({ ...draft, city: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="State"
              value={draft.state}
              onChange={(v) => setDraft({ ...draft, state: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Postal code"
              value={draft.postalCode}
              onChange={(v) => setDraft({ ...draft, postalCode: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
          </div>
          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
            Fee Agreement
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Status
              </span>
              <select
                value={draft.feeAgreementSigned ? "signed" : "unsigned"}
                onChange={(e) =>
                  setDraft({ ...draft, feeAgreementSigned: e.target.value === "signed" })
                }
                className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="unsigned">Unsigned</option>
                <option value="signed">Signed</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Signed on
              </span>
              <input
                type="date"
                value={draft.feeAgreementSignedAt}
                onChange={(e) => setDraft({ ...draft, feeAgreementSignedAt: e.target.value })}
                className="mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <LabeledField
              label="Fee %"
              value={draft.feePct}
              onChange={(v) => setDraft({ ...draft, feePct: v })}
              frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <div className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
                Billing contact
              </span>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <select
                  value={draft.feeBillingContact}
                  onChange={(e) => setDraft({ ...draft, feeBillingContact: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Select contact</option>
                  {draft.feeBillingContact && !hasSelectedBillingContact && (
                    <option value={draft.feeBillingContact}>{draft.feeBillingContact}</option>
                  )}
                  {billingContacts.map((contact) => (
                    <option key={contact.id} value={contact.value}>
                      {contact.detail ? `${contact.label} - ${contact.detail}` : contact.label}
                    </option>
                  ))}
                </select>
                <Link
                  href={createContactHref}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Create contact
                </Link>
              </div>
            </div>
          </div>
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {err}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-court-border pt-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <dl className="space-y-2.5">
            <Detail label="Company Name">
              <span>{draft.name || "—"}</span>
            </Detail>
            <Detail label="Status" icon={<ShieldCheck className="h-3 w-3" />}>
              <span
                className={
                  draft.feeAgreementSigned
                    ? "font-medium text-brand-dark"
                    : "text-court-fg-muted"
                }
              >
                {draft.feeAgreementSigned ? "Signed" : "Unsigned"}
              </span>
            </Detail>
            <Detail label="Signed On">
              <span>{signedOnDisplay || "—"}</span>
            </Detail>
            <Detail label="Fee">
              <span>{draft.feePct ? `${draft.feePct}%` : "—"}</span>
            </Detail>
            <Detail label="Agreement File" icon={<FileText className="h-3 w-3" />}>
              {agreementFile?.link ? (
                <a
                  href={agreementFile.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                >
                  {agreementFile.filename ?? "Open PDF"} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>—</span>
              )}
            </Detail>
          </dl>
          <dl className="space-y-2.5">
            <Detail label="Website" icon={<Globe className="h-3 w-3" />}>
              {websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                >
                  {draft.website} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>—</span>
              )}
            </Detail>
            <Detail label="LinkedIn">
              {draft.linkedin ? (
                <a
                  href={draft.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                >
                  Company page <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>—</span>
              )}
            </Detail>
            <Detail label="Industry">
              <span>{draft.industry || "—"}</span>
            </Detail>
            <Detail label="Address">
              {addressLines.length ? (
                <div className="space-y-0.5 text-court-fg">
                  {addressLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              ) : (
                <span>—</span>
              )}
            </Detail>
          </dl>
          <dl className="space-y-2.5">
            <Detail label="Phone" icon={<Phone className="h-3 w-3" />}>
              {draft.phones.filter(Boolean).length ? (
                <div className="space-y-0.5">
                  {draft.phones.filter(Boolean).map((p, i) => (
                    <div key={i}>
                      <a
                        href={telHref(p)}
                        className={cn(
                          "hover:text-brand-dark",
                          i === 0 ? "text-court-fg" : "text-xs text-court-fg-muted",
                        )}
                      >
                        {formatPhone(p)}
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <span>—</span>
              )}
            </Detail>
            <Detail label="Billing Contact">
              <span>{draft.feeBillingContact || "—"}</span>
            </Detail>
          </dl>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-court-fg-muted">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
}

function formatCityStateZip(cityRaw: string, stateRaw: string, postalRaw: string): string {
  const city = cityRaw.trim();
  const state = stateRaw.trim();
  const postal = postalRaw.trim();
  const cityState = [city, state].filter(Boolean).join(", ");
  return [cityState, postal].filter(Boolean).join(" ");
}
