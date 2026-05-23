"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";

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
      <div className={cn(INPUT_FRAME_CLASS, "mt-1 w-full", disabled && "opacity-60")}>
        <input
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  frameClassName?: string;
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
          className={`${INPUT_CONTROL_CLASS} resize-none text-sm leading-relaxed`}
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
