"use client";

import { forwardRef } from "react";

// Keep only digits. Drops "$", commas, spaces, letters, and decimals —
// every field this masks (salary, min fee, flat-fee override) is a
// whole-dollar amount stored as an integer, so a decimal point would
// never survive the downstream parsers / Int columns anyway.
export function currencyDigits(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  // Strip leading zeros so "007" -> "7"; keep "" for the empty state.
  return digits.replace(/^0+(?=\d)/, "");
}

// "120000" -> "$120,000". Empty digits -> "" so the field is BLANK at
// rest (no lone "$", no stray "$0"). Comma insertion is regex-based to
// avoid any Number()/toLocaleString precision quirk on long input.
export function formatCurrency(raw: string): string {
  const d = currencyDigits(raw);
  if (!d) return "";
  return "$" + d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  // Clean digit string held by the parent ("" when empty). Re-formatted
  // to "$120,000" for display on every render — the parent never sees
  // the "$"/commas.
  value: string;
  // Emits the clean digit string (no "$", no commas) on every keystroke,
  // so every existing parser (parseAmount / parseCompensation /
  // parseMoney) and save path keeps receiving a plain number string and
  // nothing downstream changes.
  onChange: (cleanDigits: string) => void;
};

// ONE shared masked-currency input. Shows a leading "$" only once the
// recruiter starts typing, digits fill to the right of it, and thousands
// commas auto-insert past 3 digits. No USD suffix. Styling is fully
// caller-controlled via `className` so it drops into every surface
// (candidate overview, job overview, Offer modal, Make Placement modal)
// while staying the single source of the masking behavior.
export const MaskedCurrencyInput = forwardRef<HTMLInputElement, Props>(
  function MaskedCurrencyInput({ value, onChange, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={formatCurrency(value)}
        onChange={(e) => onChange(currencyDigits(e.target.value))}
        {...rest}
      />
    );
  },
);
