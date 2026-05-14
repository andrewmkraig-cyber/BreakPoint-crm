"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  CLUBHOUSE_PERIOD_ITEMS,
  CLUBHOUSE_PERIOD_PARAM,
  type ClubhousePeriod,
} from "./clubhouse-period";

// URL-backed TabStrip for the Clubhouse activity strip. Pushing a new
// param triggers a server re-render of my-dashboard.tsx with fresh KPI
// counts. The default "This Week" value is omitted from the URL so the
// canonical /dashboard route stays clean.
export function ClubhousePeriodTabs({ period }: { period: ClubhousePeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <TabStrip<ClubhousePeriod>
      ariaLabel="Activity period"
      activeId={period}
      items={CLUBHOUSE_PERIOD_ITEMS}
      onChange={(id) => {
        const next = new URLSearchParams(searchParams?.toString() ?? "");
        if (id === "THIS_WEEK") {
          next.delete(CLUBHOUSE_PERIOD_PARAM);
        } else {
          next.set(CLUBHOUSE_PERIOD_PARAM, id);
        }
        const qs = next.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}
