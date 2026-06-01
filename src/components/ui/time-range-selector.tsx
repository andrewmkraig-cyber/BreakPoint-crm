"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_TIME_RANGE,
  TIME_GRAIN_ITEMS,
  encodeTimeRange,
  parseTimeRange,
  sameSelection,
  type TimeGrain,
  type TimeRangeSelection,
} from "@/lib/time-range";
import { cn } from "@/lib/utils";

// Shared combined time control. One row: a GRAIN segmented control
// (Week / Month / Quarter / Year, green-pill active) on the LEFT, a
// divider, then ‹ › arrows flanking the current-period label (eyebrow +
// concrete window) in the CENTER. The arrows page the offset; picking a
// grain resets the offset to 0 (the current period of that grain).
// Paging is unbounded unless a surface clamps it via min/maxOffset
// (Clubhouse passes maxOffset={0} so it can't page into future activity).
export function TimeRangeSelector({
  value,
  onChange,
  eyebrow,
  rangeLabel,
  grains,
  minOffset,
  maxOffset,
  ariaLabel = "Time range",
  className,
}: {
  value: TimeRangeSelection;
  onChange: (sel: TimeRangeSelection) => void;
  eyebrow: string;
  rangeLabel: string;
  grains?: ReadonlyArray<TimeGrain>;
  minOffset?: number;
  maxOffset?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const grainItems = TIME_GRAIN_ITEMS.filter((i) => !grains || grains.includes(i.id));
  const canPrev = minOffset == null || value.offset - 1 >= minOffset;
  const canNext = maxOffset == null || value.offset + 1 <= maxOffset;

  const arrowClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-court-border text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg focus:outline-none focus:ring-1 focus:ring-court-brand/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap items-center gap-3", className)}
    >
      {/* Grain segmented control — green-pill active tab inside a quiet
          rounded track. Switching grain resets to that grain's current
          period (offset 0). */}
      <div
        role="tablist"
        aria-label={`${ariaLabel} grain`}
        className="inline-flex items-center gap-1"
      >
        {grainItems.map((g) => {
          const active = g.id === value.grain;
          return (
            <button
              key={g.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange({ grain: g.id, offset: 0 })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[13px] transition focus:outline-none focus-visible:ring-1 focus-visible:ring-court-brand/40",
                active
                  ? "border-court-brand bg-transparent font-semibold text-court-brand"
                  : "border-transparent bg-transparent font-medium text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
              )}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <div aria-hidden className="h-7 w-px bg-court-border" />

      {/* Period pager — ‹ steps to the earlier period, › to the later one;
          the center shows where you are. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous period"
          disabled={!canPrev}
          onClick={() => onChange({ grain: value.grain, offset: value.offset - 1 })}
          className={arrowClass}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-[148px] px-1 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-court-brand">
            {eyebrow}
          </div>
          <div className="font-serif text-[17px] font-bold tracking-[-0.01em] text-court-fg">
            {rangeLabel}
          </div>
        </div>
        <button
          type="button"
          aria-label="Next period"
          disabled={!canNext}
          onClick={() => onChange({ grain: value.grain, offset: value.offset + 1 })}
          className={arrowClass}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Compact <select> variant for tight headers (Billing Tower). Takes an
// explicit, curated option list so each surface controls exactly which
// {grain, offset} combos it exposes and how they're labeled.
export function TimeRangeDropdown({
  value,
  options,
  onChange,
  ariaLabel = "Time range",
  disabled,
}: {
  value: TimeRangeSelection;
  options: ReadonlyArray<{ selection: TimeRangeSelection; label: string }>;
  onChange: (sel: TimeRangeSelection) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={encodeTimeRange(value)}
      disabled={disabled}
      onChange={(e) => {
        const sel = parseTimeRange(e.target.value);
        if (sel) onChange(sel);
      }}
      className="rounded-lg border border-court-border bg-court-surface px-2 py-0.5 text-[11px] text-court-fg-muted transition hover:text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/40 disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={encodeTimeRange(o.selection)} value={encodeTimeRange(o.selection)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// URL-backed wrapper. Pushing a new selection updates the chosen search param
// (encoded as "quarter.0"), omitting the value when it equals the page
// default so canonical routes stay clean. eyebrow + rangeLabel are computed
// server-side (timeRangeChrome) and passed through so the label is correct
// at first paint and updates on each navigation.
export function TimeRangeTabs({
  value,
  paramKey = "period",
  defaultSelection = DEFAULT_TIME_RANGE,
  eyebrow,
  rangeLabel,
  grains,
  minOffset,
  maxOffset,
  ariaLabel,
  className,
}: {
  value: TimeRangeSelection;
  paramKey?: string;
  defaultSelection?: TimeRangeSelection;
  eyebrow: string;
  rangeLabel: string;
  grains?: ReadonlyArray<TimeGrain>;
  minOffset?: number;
  maxOffset?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <TimeRangeSelector
      value={value}
      eyebrow={eyebrow}
      rangeLabel={rangeLabel}
      grains={grains}
      minOffset={minOffset}
      maxOffset={maxOffset}
      ariaLabel={ariaLabel}
      className={className}
      onChange={(sel) => {
        const next = new URLSearchParams(searchParams?.toString() ?? "");
        if (sameSelection(sel, defaultSelection)) next.delete(paramKey);
        else next.set(paramKey, encodeTimeRange(sel));
        const qs = next.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}
