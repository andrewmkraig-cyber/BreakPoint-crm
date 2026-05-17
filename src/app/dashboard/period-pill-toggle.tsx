"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_PERIOD_ITEMS,
  type DashboardPeriod,
} from "./period-tabs-shared";

// Scoreboard-spec pill toggle. Visually distinct from the chip-style
// `PeriodTabs`/`TabStrip` used on Placements + Finances so the
// scoreboard's rounded-2xl card surface reads as its own surface.
// URL-backed (mirrors PeriodTabs): updating the active option pushes
// ?period=… so the server component re-fetches.
export function PeriodPillToggle({
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

  function onPick(id: DashboardPeriod) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (id === "THIS_QUARTER") {
      next.delete(paramKey);
    } else {
      next.set(paramKey, id);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Period"
      className={cn(
        "inline-flex items-center rounded-full border border-court-border bg-court-surface p-0.5",
        className,
      )}
    >
      {DASHBOARD_PERIOD_ITEMS.map((item) => {
        const active = item.id === period;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onPick(item.id)}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-4 text-[12.5px] transition",
              active
                ? "bg-court-accent-tint font-semibold text-court-brand-dark"
                : "text-court-fg-muted hover:text-court-fg",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
