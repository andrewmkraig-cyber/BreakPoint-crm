"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
    <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
    </label>
  );
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full resize-vertical rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm leading-relaxed text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
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
