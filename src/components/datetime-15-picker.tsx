"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
  blockPast,
}: {
  value: string; // "" or "YYYY-MM-DDTHH:mm"
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  // When true, the date input's `min` is today and the time dropdown
  // hides slots that have already passed (with a 30-min buffer) when
  // today is the selected date. Used by the Schedule Interview dialog
  // so recruiters can't accidentally book a slot in the past.
  blockPast?: boolean;
}) {
  const { datePart, timePart } = splitValue(value);

  // Today's date as YYYY-MM-DD via toISOString — matches Andrew's spec
  // and is accurate in ET for the hours of day he typically schedules.
  const todayIso = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Earliest allowed "HH:mm" when the picked date IS today. We add a
  // 30-min buffer to "now" so a recruiter can't book a slot that has
  // already started or is about to. Snap UP to the next 15-min boundary
  // so the cutoff aligns with the option grid.
  const minTimeToday = useMemo(() => {
    if (!blockPast) return null;
    const now = new Date();
    const buffered = new Date(now.getTime() + 30 * 60 * 1000);
    const h = buffered.getHours();
    const m = buffered.getMinutes();
    const totalMin = h * 60 + m;
    const snapped = Math.ceil(totalMin / 15) * 15;
    const clamped = Math.min(snapped, 23 * 60 + 45);
    return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
  }, [blockPast]);

  const timeOptions = useMemo(() => {
    const all = buildTimeOptions();
    if (!blockPast || !minTimeToday) return all;
    if (datePart && datePart > todayIso) return all;
    if (datePart === todayIso) return all.filter((o) => o.value >= minTimeToday);
    return all;
  }, [blockPast, datePart, todayIso, minTimeToday]);

  // Defensive snap: if the caller hands us a value whose time part isn't
  // on a 15-min boundary (e.g. a reschedule dialog initializing from a
  // legacy row that predates this picker), normalize it upward. Without
  // this the <select> would show the placeholder but the parent state
  // would still hold the off-grid time.
  useEffect(() => {
    if (!datePart || !timePart) return;
    const snapped = snapTimePart(timePart);
    if (snapped !== timePart) {
      onChange(`${datePart}T${snapped}`);
    }
    // We intentionally omit onChange from deps; callers typically pass an
    // inline arrow fn that would cause an infinite loop. The effect is
    // keyed on value parts which capture the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePart, timePart]);

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
    "rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className={cn("flex flex-wrap items-stretch gap-2", className)}>
      <input
        type="date"
        value={datePart}
        onChange={(e) => setDate(e.target.value)}
        disabled={disabled}
        min={blockPast ? todayIso : undefined}
        className={cn(inputBase, "min-w-[10rem] flex-1")}
      />
      <TimeSelect
        value={timePart}
        options={timeOptions}
        onChange={setTime}
        disabled={disabled}
        className="min-w-[7rem] flex-1"
        inputClassName={inputBase}
      />
    </div>
  );
}

// Custom time dropdown — replaces the native <select> because browsers
// open <select> panels at "natural" height, which for our 96-slot
// 15-minute grid runs taller than the viewport and forces the user
// to scroll the whole page to reach late times. This component caps
// the panel at max-h-64 (~10 slots visible) and scrolls inside,
// matching the recruiter's "keep the list shorter, let me scroll"
// request without changing the value contract.
function TimeSelect({
  value,
  options,
  onChange,
  disabled,
  className,
  inputClassName,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const label = selected?.label ?? "Pick a time";

  // Outside-click dismiss. Document-level listener gated by `open` so
  // we don't slap an inset-0 overlay on top of the surrounding modal
  // (which would eat clicks on the body text fields, same trap the
  // contact picker hit earlier).
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (node && node.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // On open, scroll the selected option into view so the picker
  // doesn't always show 6:30 AM as the top item when the recruiter
  // is reopening a previously-set 3 PM slot.
  useEffect(() => {
    if (!open || !value) return;
    const list = listRef.current;
    if (!list) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const item = list.children[idx] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: "center" });
  }, [open, value, options]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          inputClassName,
          "flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <span className={cn(!selected && "text-court-fg-muted")}>{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
      </button>
      {open && (
        // z-[70] sits above the z-50 modal backdrop the picker tends
        // to live inside (Schedule / Reschedule dialogs). max-h-64
        // caps the panel at ~10 rows so it never punches through the
        // viewport, regardless of how the picker is positioned.
        <ul
          ref={listRef}
          className="absolute left-0 top-full z-[70] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-court-border bg-court-surface py-1 shadow-lg"
        >
          {options.map((o) => {
            const isSelected = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm transition",
                    isSelected
                      ? "bg-brand-tint text-court-fg"
                      : "text-court-fg hover:bg-court-surface-subtle",
                  )}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

// Snaps an "HH:mm" string to the nearest 15-min slot. Clamps overflow
// to 23:45 to stay within a single day — rollover to the next day would
// silently change the date part, which is a worse surprise than a 15-min
// ceiling.
function snapTimePart(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "00:00";
  const totalMin = h * 60 + m;
  const snapped = Math.round(totalMin / 15) * 15;
  const clamped = Math.min(Math.max(snapped, 0), 23 * 60 + 45);
  const sh = Math.floor(clamped / 60);
  const sm = clamped % 60;
  return `${pad2(sh)}:${pad2(sm)}`;
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
