"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// Quarter-hour time picker shared by the event drawer and the reminders
// panel. Native <input type="time"> can't restrict entry to 00/15/30/45
// nor close itself on selection, so both surfaces use this dropdown of
// fixed slots instead.

export function timeLabel(h: number, m: number): string {
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const slots: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 15, 30, 45]) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      slots.push({ value, label: timeLabel(h, m) });
    }
  }
  return slots;
})();

// Display a stored "HH:mm" in 12-hour form. Falls back gracefully for an
// off-grid value (a synced event at 10:07) so editing one doesn't force
// it onto a quarter-hour until the recruiter picks a new slot.
export function formatTimeLabel(value: string): string {
  const [hStr, mStr] = (value || "").split(":");
  const h = Number.parseInt(hStr, 10);
  const m = Number.parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return "Select time";
  return timeLabel(h, m);
}

export function TimeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const sel = listRef.current.querySelector<HTMLElement>(
      '[data-selected="true"]',
    );
    sel?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[38px] w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-left text-[13.5px] text-court-fg outline-none focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
        <span className="flex-1">{formatTimeLabel(value)}</span>
      </button>
      {open && (
        <ul
          ref={listRef}
          className="absolute left-0 right-0 top-[42px] z-30 max-h-[220px] overflow-auto rounded-md border border-court-border bg-court-surface py-1 shadow-lg"
        >
          {TIME_SLOTS.map((slot) => {
            const selected = slot.value === value;
            return (
              <li key={slot.value} data-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(slot.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-[13px]",
                    selected
                      ? "bg-court-brand-tint/60 font-semibold text-court-brand-dark"
                      : "text-court-fg hover:bg-court-surface-subtle",
                  )}
                >
                  {slot.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
