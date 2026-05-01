"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/pipeline": "Pipeline",
  "/applicants": "Applicants",
  "/candidates": "Candidates",
  "/clients": "Clients",
  "/jobs": "Jobs",
  "/mail": "Mail",
  "/phone": "Phone",
  "/settings": "Settings",
};

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const pathname = usePathname() ?? "";
  const currentLabel =
    ROUTE_LABELS[pathname] ??
    Object.entries(ROUTE_LABELS).find(([k]) => pathname.startsWith(k + "/"))?.[1] ??
    "";

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-4 bg-court-surface px-6">
      <div className="flex min-w-0 items-center gap-2">
        {currentLabel && (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
              Ace
            </span>
            <span className="text-court-fg-muted/50">/</span>
            <span className="font-serif text-sm font-semibold text-court-fg">
              {currentLabel}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 md:flex-none md:w-96">
        <div className="rounded-lg border border-court-border bg-court-surface-subtle/60 transition focus-within:border-court-accent focus-within:bg-court-surface">
          <TopBarSearch />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-[11px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted lg:block">
          {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </div>
        <ComposeFAB />
        <TopBarProfileCard name={user?.name ?? null} imageUrl={user?.image ?? null} />
      </div>
    </header>
  );
}
