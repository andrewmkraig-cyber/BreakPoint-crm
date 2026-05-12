"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type DashboardTab = "dashboard" | "scoreboard" | "invoicing";

export const DASHBOARD_TAB_LABELS: Record<DashboardTab, string> = {
  dashboard: "Dashboard",
  scoreboard: "Scoreboard",
  invoicing: "Invoicing",
};

const TAB_ORDER: DashboardTab[] = ["dashboard", "scoreboard", "invoicing"];

export function resolveDashboardTab(raw: string | undefined | null): DashboardTab {
  if (raw === "scoreboard" || raw === "invoicing") return raw;
  return "dashboard";
}

type Props = {
  active: DashboardTab;
  counts?: Partial<Record<DashboardTab, number>>;
};

export function DashboardTabs({ active, counts }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="inline-flex items-center gap-1 rounded-full border border-court-brand/30 bg-court-brand-tint p-1"
    >
      {TAB_ORDER.map((tab) => (
        <TabLink key={tab} tab={tab} active={active === tab} count={counts?.[tab]} />
      ))}
    </div>
  );
}

function TabLink({
  tab,
  active,
  count,
}: {
  tab: DashboardTab;
  active: boolean;
  count?: number;
}) {
  // Build the href using the live searchParams so unrelated params survive
  // a tab switch — there shouldn't be many, but if Andrew lands on
  // /dashboard?ref=email we don't want to drop that hint.
  const params = useSearchParams();
  const next = new URLSearchParams(params?.toString());
  if (tab === "dashboard") next.delete("tab");
  else next.set("tab", tab);
  const qs = next.toString();
  const href = qs ? `/dashboard?${qs}` : "/dashboard";

  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      scroll={false}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold transition",
        active
          ? "bg-court-surface text-court-fg shadow-sm"
          : "text-court-fg-muted hover:text-court-fg",
      )}
    >
      {DASHBOARD_TAB_LABELS[tab]}
      {count != null && count > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums",
            active
              ? "bg-court-brand-dark text-white"
              : "bg-court-brand/20 text-court-brand-dark",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
