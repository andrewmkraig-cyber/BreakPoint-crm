"use client";

import { useState, useTransition } from "react";
import { savePersonalInfo } from "@/app/settings/personal-info-actions";
import {
  TSHIRT_SIZES,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";

export function PersonalInfoView({
  initial,
}: {
  initial: PersonalInfoRow;
}) {
  const [birthday, setBirthday] = useState(initial.birthday ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [tshirtSize, setTshirtSize] = useState(initial.tshirtSize ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await savePersonalInfo({
        birthday: birthday || null,
        address: address || null,
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

      <Field label="Address">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, State 12345"
          className="block w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        />
      </Field>

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
          className="rounded-md bg-court-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-court-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
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
