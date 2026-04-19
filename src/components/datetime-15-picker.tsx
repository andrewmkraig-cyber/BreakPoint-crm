"use client";

import * as React from "react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

// Drop-in replacement for <input type="datetime-local"> that enforces
// 15-minute time increments via a <select> dropdown — so the user
// literally cannot pick a non-15-minute slot. We previously tried
// `step={900}` on the native input; most browsers treat it as a hint
// rather than a constraint, so arbitrary times like 8:13 slipped through.
//
// Value format matches datetime-local exactly: `YYYY-MM-DDTHH:mm` in
// the user's LOCAL time zone. The caller is responsible for converting
// to ISO (UTC) before saving.

export function DateTime15Picker({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string; // "" or "YYYY-MM-DDTHH:mm"
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const { datePart, timePart } = splitValue(value);

  const timeOptions = useMemo(() => buildTimeOptions(), []);

  function setDate(d: string) {
    if (!d) {
      onChange("");
      return;
    }
    // When a date is picked without a time yet, seed 09:00 as a sensible
    // default so the caller never ends up with a half-filled "YYYY-MM-DD"
    // string masquerading as a datetime.
    const time = timePart || "09:00";
    onChange(`${d}T${time}`);
  }

  function setTime(t: string) {
    if (!t) {
      // Rare: user clears the time. Emit empty so the caller can validate.
      onChange(datePart ? datePart : "");
      return;
    }
    if (!datePart) {
      // Time picked before date — hold it; caller's validation will surface
      // "pick a date" before save.
      onChange(`T${t}`);
      return;
    }
    onChange(`${datePart}T${t}`);
  }

  const inputBase =
    "rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className={cn("flex flex-wrap items-stretch gap-2", className)}>
      <input
        type="date"
        value={datePart}
        onChange={(e) => setDate(e.target.value)}
        disabled={disabled}
        className={cn(inputBase, "min-w-[10rem] flex-1")}
      />
      <select
        value={timePart}
        onChange={(e) => setTime(e.target.value)}
        disabled={disabled}
        className={cn(inputBase, "min-w-[7rem] flex-1")}
      >
        <option value="">— time —</option>
        {timeOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Parses a datetime-local string into ["YYYY-MM-DD", "HH:mm"] halves.
// Tolerates partial values like "T09:00" (time-only) and "2026-04-19"
// (date-only), so interim states during input don't blow up.
function splitValue(v: string): { datePart: string; timePart: string } {
  if (!v) return { datePart: "", timePart: "" };
  const idx = v.indexOf("T");
  if (idx === -1) return { datePart: v, timePart: "" };
  const date = v.slice(0, idx);
  const time = v.slice(idx + 1, idx + 6); // "HH:mm"
  return { datePart: date, timePart: time };
}

function buildTimeOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${pad2(h)}:${pad2(m)}`;
      opts.push({ value, label: format12h(h, m) });
    }
  }
  return opts;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function format12h(h: number, m: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad2(m)} ${period}`;
}
