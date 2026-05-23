"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { savePersonalInfo } from "@/app/settings/personal-info-actions";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import {
  TSHIRT_SIZES,
  type AddressFields,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";

export function PersonalInfoView({
  initial,
}: {
  initial: PersonalInfoRow;
}) {
  const [birthday, setBirthday] = useState(initial.birthday ?? "");
  const [address, setAddress] = useState<AddressFields>(initial.address);
  const [tshirtSize, setTshirtSize] = useState(initial.tshirtSize ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function setAddressField<K extends keyof AddressFields>(
    field: K,
    value: AddressFields[K],
  ) {
    setAddress((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await savePersonalInfo({
        birthday: birthday || null,
        address,
        tshirtSize: tshirtSize || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <div className="space-y-5">
      <Field label="Birthday" hint="Drives your dashboard horoscope automatically.">
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          className="block w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-court-fg">
          Address
        </legend>
        <SubField label="Street">
          <div className={`${INPUT_FRAME_CLASS} w-full`}>
            <input
              type="text"
              value={address.street}
              onChange={(e) => setAddressField("street", e.target.value)}
              placeholder="123 Main St"
              className={`${INPUT_CONTROL_CLASS} text-sm`}
            />
          </div>
        </SubField>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:gap-3">
          <SubField label="City">
            <div className={`${INPUT_FRAME_CLASS} w-full`}>
              <input
                type="text"
                value={address.city}
                onChange={(e) => setAddressField("city", e.target.value)}
                placeholder="Solon"
                className={`${INPUT_CONTROL_CLASS} text-sm`}
              />
            </div>
          </SubField>
          <SubField label="State">
            <div className={`${INPUT_FRAME_CLASS} w-20`}>
              <input
                type="text"
                value={address.state}
                onChange={(e) => setAddressField("state", e.target.value)}
                placeholder="OH"
                maxLength={32}
                className={`${INPUT_CONTROL_CLASS} uppercase text-sm`}
              />
            </div>
          </SubField>
          <SubField label="ZIP">
            <div className={`${INPUT_FRAME_CLASS} w-28`}>
              <input
                type="text"
                value={address.zip}
                onChange={(e) => setAddressField("zip", e.target.value)}
                placeholder="44139"
                inputMode="numeric"
                maxLength={10}
                className={`${INPUT_CONTROL_CLASS} tabular-nums text-sm`}
              />
            </div>
          </SubField>
        </div>
      </fieldset>

      <Field label="T-Shirt Size">
        <select
          value={tshirtSize}
          onChange={(e) => setTshirtSize(e.target.value)}
          className="block w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        >
          <option value="">—</option>
          {TSHIRT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {savedAt && !pending && !error && (
          <span className="text-xs text-court-fg-muted">Saved.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-court-fg">{label}</div>
      {hint && <div className="mb-1.5 text-xs text-court-fg-muted">{hint}</div>}
      {children}
    </label>
  );
}

function SubField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-court-fg-muted">
        {label}
      </div>
      {children}
    </label>
  );
}
