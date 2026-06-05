"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { MaskedCurrencyInput } from "@/components/ui/masked-currency-input";

export function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">{title}</h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function LabeledField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  suffix,
  currency,
  // Frame variant for the wrapper. Defaults to the pill (INPUT_FRAME_CLASS)
  // so existing callers (candidate / job / settings forms) are untouched;
  // the client company form opts into the rectangular variant via this prop.
  frameClassName = INPUT_FRAME_CLASS,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  frameClassName?: string;
  // When true the inner input is the shared MaskedCurrencyInput: blank at
  // rest, a leading "$" appears as digits are typed, thousands commas
  // auto-insert, and onChange emits clean digits only. Mutually
  // exclusive with `suffix` (the USD suffix is dropped on currency
  // fields). Omit to keep the plain text input byte-identical.
  currency?: boolean;
  // Static chrome rendered after the input (e.g. "USD" on the salary
  // field). pointer-events-none + select-none + aria-hidden + cursor-
  // default make it visually look like a unit indicator but actually
  // inert — clicking it focuses NOTHING (not the input, not the
  // suffix). The standard <label>-wraps-input pattern would forward a
  // click on the suffix to focus the input; when suffix is set we
  // bypass that by rendering the field's text-label as a separate
  // <label htmlFor={id}> sibling and the frame as a plain <div>, so
  // only the label-text region and the input itself receive focus on
  // click. Pass `undefined` to opt out; that path stays byte-identical
  // to the original implementation.
  suffix?: ReactNode;
}) {
  // useId is always called (rules of hooks) but only consumed in the
  // suffix branch — the suffix-less branch keeps its native
  // <label>-wraps-input structure so existing callers see no DOM diff.
  const inputId = useId();
  if (suffix !== undefined) {
    return (
      <div className="block text-sm">
        <label
          htmlFor={inputId}
          className="text-[11px] uppercase tracking-wider text-court-fg-muted"
        >
          {label}
        </label>
        <div className={cn(frameClassName, "mt-1 w-full", disabled && "opacity-60")}>
          <input
            id={inputId}
            type={type}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`${INPUT_CONTROL_CLASS} text-sm`}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none mr-3 shrink-0 cursor-default select-none text-xs font-medium uppercase tracking-wider text-court-fg-muted"
          >
            {suffix}
          </span>
        </div>
      </div>
    );
  }
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <div className={cn(frameClassName, "mt-1 w-full", disabled && "opacity-60")}>
        {currency ? (
          <MaskedCurrencyInput
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={onChange}
            className={`${INPUT_CONTROL_CLASS} text-sm`}
          />
        ) : (
          <input
            type={type}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`${INPUT_CONTROL_CLASS} text-sm`}
          />
        )}
      </div>
    </label>
  );
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  // Frame variant for the wrapper. Defaults to the pill (INPUT_FRAME_CLASS) so
  // existing callers (candidate detail page) are untouched; the New Job
  // Description field opts into the rectangular variant via this prop.
  frameClassName = INPUT_FRAME_CLASS,
  // Extra classes for the inner <textarea>. Defaults to none so existing
  // callers render identically; the New Job Description passes "rounded-xl"
  // so the control's corners match its rectangular frame.
  controlClassName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  frameClassName?: string;
  controlClassName?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <div className={cn(frameClassName, "mt-1 w-full")}>
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(INPUT_CONTROL_CLASS, "resize-none text-sm leading-relaxed", controlClassName)}
        />
      </div>
    </label>
  );
}

export type MonthYear = [number | null, number | null];

export function formatMonthYear(my: MonthYear | null | undefined): string {
  if (!my || my[1] == null) return "";
  const month = my[0] ? String(my[0]).padStart(2, "0") : "";
  return month ? `${month}/${my[1]}` : String(my[1]);
}

// Accepts MM/YYYY, M/YYYY, or YYYY. Empty string → [null, null].
export function parseMonthYear(s: string): MonthYear {
  const trimmed = s.trim();
  if (!trimmed) return [null, null];
  const slashed = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashed) return [Number(slashed[1]), Number(slashed[2])];
  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) return [null, Number(yearOnly[1])];
  return [null, null];
}
