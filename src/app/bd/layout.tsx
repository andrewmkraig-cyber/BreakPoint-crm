"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings2 } from "lucide-react";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";

// BD module shell. Hosts the 4-tab strip across every /bd/* page and a
// right-aligned BD Settings link. Counts on the tabs (campaigns,
// signals, activity) will wire in once those tabs render real data —
// for now the strip ships with labels only so the unified style still
// matches the spec (rounded-md, brand-green outline on active).
type BdTabId = "launch" | "client-signal" | "campaigns" | "activity";

const TABS: ReadonlyArray<TabStripItem<BdTabId>> = [
  { id: "launch", label: "Today's Launch", href: "/bd/launch" },
  { id: "campaigns", label: "Active Campaigns", href: "/bd/campaigns" },
  { id: "activity", label: "Activity", href: "/bd/activity" },
  { id: "client-signal", label: "Client Signals", href: "/bd/client-signal" },
];

function resolveTab(pathname: string): BdTabId {
  if (pathname.startsWith("/bd/client-signal")) return "client-signal";
  if (pathname.startsWith("/bd/campaigns")) return "campaigns";
  if (pathname.startsWith("/bd/activity")) return "activity";
  return "launch";
}

export default function BdLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/bd/launch";
  const active = resolveTab(pathname);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TabStrip<BdTabId> items={TABS} activeId={active} ariaLabel="BD sections" />
        <Link
          href="/settings/bd"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[13px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <Settings2 className="h-3.5 w-3.5" />
          BD Settings
        </Link>
      </header>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
