"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  DEFAULT_TIME_RANGE,
  TIME_GRAIN_ITEMS,
  TIME_PERIOD_ITEMS,
  encodeTimeRange,
  parseTimeRange,
  sameSelection,
  type TimeGrain,
  type TimePeriod,
  type TimeRangeSelection,
} from "@/lib/time-range";

// Shared two-tier time-range selector. A GRAIN row (Week / Month / Quarter /
// Year) stacked over a PERIOD row (Last / This / Next) — both rendered
// through the shared TabStrip so they inherit its proximity-hover treatment.
// Consumers can narrow which grains/periods show via the allow-list props.
export function TimeRangeSelector({
  value,
  onChange,
  grains,
  periods,
  ariaLabel = "Time range",
  className,
}: {
  value: TimeRangeSelection;
  onChange: (sel: TimeRangeSelection) => void;
  grains?: ReadonlyArray<TimeGrain>;
  periods?: ReadonlyArray<TimePeriod>;
  ariaLabel?: string;
  className?: string;
}) {
  const grainItems = TIME_GRAIN_ITEMS.filter((i) => !grains || grains.includes(i.id));
  const periodItems = TIME_PERIOD_ITEMS.filter((i) => !periods || periods.includes(i.id));
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={["flex flex-col items-end gap-1", className].filter(Boolean).join(" ")}
    >
      <TabStrip<TimeGrain>
        ariaLabel={`${ariaLabel} grain`}
        activeId={value.grain}
        items={grainItems}
        onChange={(grain) => onChange({ grain, period: value.period })}
      />
      <TabStrip<TimePeriod>
        ariaLabel={`${ariaLabel} period`}
        activeId={value.period}
        items={periodItems}
        onChange={(period) => onChange({ grain: value.grain, period })}
      />
    </div>
  );
}

// Compact <select> variant for tight headers (Billing Tower). Takes an
// explicit, curated option list so each surface controls exactly which
// {grain, period} combos it exposes and how they're labeled.
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
// (encoded as "quarter-this"), omitting the value when it equals the page
// default so canonical routes stay clean — same pattern the old PeriodTabs /
// ClubhousePeriodTabs used, now over the two-tier model.
export function TimeRangeTabs({
  value,
  paramKey = "period",
  defaultSelection = DEFAULT_TIME_RANGE,
  grains,
  periods,
  ariaLabel,
  className,
}: {
  value: TimeRangeSelection;
  paramKey?: string;
  defaultSelection?: TimeRangeSelection;
  grains?: ReadonlyArray<TimeGrain>;
  periods?: ReadonlyArray<TimePeriod>;
  ariaLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <TimeRangeSelector
      value={value}
      grains={grains}
      periods={periods}
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
