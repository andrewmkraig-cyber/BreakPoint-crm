"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";

import type { BillingSettings } from "@/lib/billing-settings";

import { saveBillingSettingsAction } from "./actions";

type FieldDef = {
  key: keyof BillingSettings;
  label: string;
  placeholder?: string;
  type?: "text" | "textarea";
  hint?: string;
};

const COMPANY_FIELDS: FieldDef[] = [
  { key: "companyName", label: "Company name" },
  { key: "ein", label: "EIN", placeholder: "XX-XXXXXXX" },
  { key: "addressLine1", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "arEmail", label: "Accounts Receivable email", placeholder: "ar@yourdomain.com" },
  { key: "arPhone", label: "Accounts Receivable phone" },
  { key: "website", label: "Website" },
  {
    key: "defaultPaymentTerms",
    label: "Default payment terms",
    placeholder: "Net 30",
    hint: "Used when a placement doesn't override.",
  },
];

const BANK_FIELDS: FieldDef[] = [
  { key: "bankName", label: "Bank name" },
  { key: "bankBeneficiary", label: "Beneficiary" },
  { key: "bankRouting", label: "Routing / ABA" },
  { key: "bankAccount", label: "Account number" },
  { key: "bankSwift", label: "SWIFT (optional)" },
];

const CHECK_FIELDS: FieldDef[] = [
  { key: "checkPayableTo", label: "Make checks payable to" },
  { key: "checkMailingAddress", label: "Check mailing address", type: "textarea" },
];

export function BillingSettingsForm({ initial }: { initial: BillingSettings }) {
  const [values, setValues] = useState<BillingSettings>(initial);
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof BillingSettings>(key: K, value: BillingSettings[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveBillingSettingsAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedAt(new Date());
    });
  }

  return (
    <div className="flex flex-col gap-7">
      <FieldGroup title="Company identity" fields={COMPANY_FIELDS} values={values} update={update} />
      <FieldGroup title="ACH / Wire" fields={BANK_FIELDS} values={values} update={update} />
      <FieldGroup title="Check" fields={CHECK_FIELDS} values={values} update={update} />

      <div className="flex items-center gap-3 border-t border-court-border pt-5">
        <button
          type="button"
          disabled={isPending}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {savedAt ? (
          <span className="text-[11px] text-court-fg-muted">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        ) : null}
        {error ? (
          <span className="text-[11px] font-semibold text-red-700">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

function FieldGroup({
  title,
  fields,
  values,
  update,
}: {
  title: string;
  fields: FieldDef[];
  values: BillingSettings;
  update: <K extends keyof BillingSettings>(key: K, value: BillingSettings[K]) => void;
}) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
        {title}
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 sm:col-span-1 [&:has(textarea)]:sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              {f.label}
            </span>
            {f.type === "textarea" ? (
              <textarea
                rows={3}
                value={values[f.key] as string}
                onChange={(e) => update(f.key, e.target.value as BillingSettings[typeof f.key])}
                placeholder={f.placeholder}
                className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg shadow-sm focus:border-court-accent focus:outline-none"
              />
            ) : (
              <input
                type="text"
                value={values[f.key] as string}
                onChange={(e) => update(f.key, e.target.value as BillingSettings[typeof f.key])}
                placeholder={f.placeholder}
                className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg shadow-sm focus:border-court-accent focus:outline-none"
              />
            )}
            {f.hint ? <span className="text-[11px] text-court-fg-muted">{f.hint}</span> : null}
          </label>
        ))}
      </div>
    </section>
  );
}
