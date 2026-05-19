"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatPhone, telHref } from "@/lib/rf-payload-shapes";
import { updateClientCompany } from "@/app/clients/[id]/actions";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";

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
  website: string;
  linkedin: string;
  phone: string;
  industry: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  feeAgreementSigned: boolean;
  feeAgreementSignedAt: string;
  feePct: string;
  feeBillingContact: string;
};

export function EditableCompany({
  clientCuid,
  initial,
  agreementFile,
}: {
  clientCuid: string;
  initial: CompanyState;
  agreementFile?: { filename: string; link: string } | null;
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
    [draft.city, draft.state, draft.postalCode].filter(Boolean).join(", "),
    draft.country,
  ].filter(Boolean);
  const websiteHref = draft.website
    ? draft.website.startsWith("http")
      ? draft.website
      : `https://${draft.website}`
    : "";
  const signedOnDisplay = draft.feeAgreementSignedAt
    ? new Date(draft.feeAgreementSignedAt).toLocaleDateString()
    : "";

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface p-4 shadow-sm lg:col-span-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Company &amp; Fee Agreement
        </h2>
        {!editing && (
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
              label="Website"
              value={draft.website}
              onChange={(v) => setDraft({ ...draft, website: v })}
              placeholder="example.com"
            />
            <LabeledField
              label="LinkedIn"
              value={draft.linkedin}
              onChange={(v) => setDraft({ ...draft, linkedin: v })}
              placeholder="https://linkedin.com/company/…"
            />
            <LabeledField
              label="Phone"
              value={draft.phone}
              onChange={(v) => setDraft({ ...draft, phone: v })}
              placeholder="+1 555-555-5555"
            />
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
            />
            <LabeledField
              label="Street 2"
              value={draft.street2}
              onChange={(v) => setDraft({ ...draft, street2: v })}
            />
            <LabeledField
              label="City"
              value={draft.city}
              onChange={(v) => setDraft({ ...draft, city: v })}
            />
            <LabeledField
              label="State"
              value={draft.state}
              onChange={(v) => setDraft({ ...draft, state: v })}
            />
            <LabeledField
              label="Postal code"
              value={draft.postalCode}
              onChange={(v) => setDraft({ ...draft, postalCode: v })}
            />
            <LabeledField
              label="Country"
              value={draft.country}
              onChange={(v) => setDraft({ ...draft, country: v })}
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
              placeholder="20"
            />
            <LabeledField
              label="Billing contact"
              value={draft.feeBillingContact}
              onChange={(v) => setDraft({ ...draft, feeBillingContact: v })}
              placeholder="ap@example.com"
            />
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
            <button
              type="button"
              onClick={onSave}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}{" "}
              Save
            </button>
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
          <Detail label="Phone" icon={<Phone className="h-3 w-3" />}>
            {draft.phone ? (
              <a href={telHref(draft.phone)} className="text-court-fg hover:text-brand-dark">
                {formatPhone(draft.phone)}
              </a>
            ) : (
              <span>—</span>
            )}
          </Detail>
          <Detail label="Industry">
            <span>{draft.industry || "—"}</span>
          </Detail>
          <Detail label="Address" icon={<MapPin className="h-3 w-3" />}>
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
          <Detail label="Billing Contact">
            <span>{draft.feeBillingContact || "—"}</span>
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
