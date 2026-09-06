"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { TabStrip } from "@/components/ui/tab-strip";
import {
  DEFAULT_GOALS_PERIOD,
  GOALS_GRAIN_ITEMS,
  GOALS_PERIOD_PARAM,
  encodeGoalsPeriod,
  type GoalsGrain,
  type GoalsPeriodSelection,
} from "@/app/dashboard/goals-period";

// Goals period row. Uses the shared TabStrip in controlled mode - no
// hand-rolled pill row (Ace 66.0). It deliberately does NOT reuse
// TimeRangeSelector: that control is built around the shared four-grain
// TimeGrain union and has no Day, and teaching it Day would change the
// grain list on Scoreboard, Placements and Clubhouse. See goals-period.ts.
//
// Picking a grain resets the offset to 0, matching TimeRangeSelector's
// behaviour so the two controls feel the same even though they are
// separate components. The default selection is dropped from the URL so
// the canonical route stays clean, the same trick TimeRangeTabs uses.
export function GoalsPeriodTabs({
  value,
  rangeLabel,
}: {
  value: GoalsPeriodSelection;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <TabStrip<GoalsGrain>
        items={GOALS_GRAIN_ITEMS}
        activeId={value.grain}
        ariaLabel="Goals period"
        onChange={(grain) => {
          const next = new URLSearchParams(searchParams?.toString() ?? "");
          const sel: GoalsPeriodSelection = { grain, offset: 0 };
          if (sel.grain === DEFAULT_GOALS_PERIOD.grain && sel.offset === DEFAULT_GOALS_PERIOD.offset) {
            next.delete(GOALS_PERIOD_PARAM);
          } else {
            next.set(GOALS_PERIOD_PARAM, encodeGoalsPeriod(sel));
          }
          const qs = next.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
      />
      {/* A read-only window label, not a tab. The "Showing:" prefix and the
          extra left margin keep it from reading as a sixth option next to the
          active grain pill. */}
      <span className="ml-3 text-[13px] font-medium text-court-fg-muted">Showing: {rangeLabel}</span>
    </div>
  );
}
