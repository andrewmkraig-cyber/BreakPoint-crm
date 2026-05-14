"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  DASHBOARD_PERIOD_ITEMS,
  type DashboardPeriod,
} from "./period-tabs-shared";

// Unified 4-option period selector used on Scoreboard, Placements, and
// the Finances Revenue & Profitability tab. URL-backed (so the server
// component re-fetches with the new period) but rendered through
// TabStrip's controlled `onChange` API per the design spec. Pure
// helpers live in period-tabs-shared.ts so server components can call
// them without crossing the RSC client-reference boundary.
export function PeriodTabs({
  period,
  paramKey = "period",
  className,
}: {
  period: DashboardPeriod;
  paramKey?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <TabStrip<DashboardPeriod>
      ariaLabel="Period"
      activeId={period}
      items={DASHBOARD_PERIOD_ITEMS}
      className={className}
      onChange={(id) => {
        const next = new URLSearchParams(searchParams?.toString() ?? "");
        if (id === "THIS_QUARTER") {
          next.delete(paramKey);
        } else {
          next.set(paramKey, id);
        }
        const qs = next.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}
