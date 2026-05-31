"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, FOOTER_NAV, type NavItemData } from "@/components/nav-items";
import { BrandMark } from "@/components/brand-mark";
import { SidebarProfileCard } from "@/components/sidebar-profile-card";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";
import {
  isNavItemActive,
  resolveDashboardTab,
  type DashboardTab,
} from "@/components/nav-active";

// NAV_GROUPS (with the per-item rainbow iconColor) and FOOTER_NAV now live
// in @/components/nav-items so the desktop Sidebar and the mobile drawer
// (MobileNav) share one source of truth and their icon colors can never
// drift. This file owns only the desktop NavLink chrome.

export function Sidebar({ width }: { width?: number } = {}) {
  const pathname = usePathname();
  // /dashboard?tab=scoreboard and ?tab=placements share the pathname /dashboard
  // with Clubhouse — a pathname-only active check lights up all three at once.
  // Reading the resolved dashboard tab here lets isNavItemActive() pick the
  // right row. See src/components/nav-active.ts for the discrimination logic.
  const searchParams = useSearchParams();
  const resolvedDashboardTab = resolveDashboardTab(searchParams?.get("tab"));
  const { unreadCount } = useMailContext();
  const { unreadCount: phoneUnreadCount } = usePhoneContext();

  return (
    // Sidebar reads from the dedicated --court-sidebar-* token family
    // so each Court Mode can pick its own sidebar bg, border, and text
    // independent of the card surface. In Clay Light the sidebar is tan
    // (#E8C9B0) while cards stay near-white; in Grass Light the sidebar
    // is dark Wimbledon green (#1F5638) with white text and a translucent
    // active-state wash. Sticky positioning + h-screen keeps it visible
    // as the page content scrolls. Width is driven by the AppShell.
    <aside
      data-in-sidebar="true"
      style={width ? { width: `${width}px` } : undefined}
      className={
        "sticky top-0 hidden h-screen shrink-0 self-start border-r border-court-sidebar-border bg-court-sidebar-bg md:flex md:flex-col " +
        (width ? "" : "w-60")
      }
    >
      <Link
        href="/dashboard"
        aria-label="Ace dashboard"
        className="relative flex h-20 shrink-0 items-center overflow-hidden border-b border-court-sidebar-border px-5 transition-opacity hover:opacity-80"
      >
        {/* Soft brand-green radial glow centered on the favicon so the
            top-left brand area reads as lit. overflow-hidden clips it at
            the header's bottom border, so it fades out before the
            Clubhouse row. Gated off on light sidebars in globals.css. */}
        <span
          aria-hidden="true"
          className="ace-sidebar-halo pointer-events-none absolute -left-2 top-1 h-28 w-28 rounded-full bg-[rgb(var(--court-brand)/0.14)] blur-2xl"
        />
        <BrandMark />
      </Link>
      {/* Nav groups stack naturally near the top (justify-start, never
          justify-between). Spacing is FLUID, not fixed: the group gap,
          row height, and group-header margins are each clamp()'d against
          100dvh so they grow and shrink with the viewport between sane
          min/max caps. Short laptop -> rows + gaps ride near their floor
          so every group (Scoreboard/Metrics/Placements included) plus the
          pinned Settings + profile footer fit without scrolling and
          without looking crushed. Tall monitor -> rows + gaps climb
          toward their max, so the nav itself breathes more (not just a
          bigger empty gap). The caps bind near ~1700px tall, so the whole
          common range keeps scaling. min-h-0 + overflow-y-auto lets the
          nav scroll only on an extremely short viewport. flex-1 means any
          remaining height (after spacing maxes out on very tall screens)
          pools as a single gap directly above the footer, never
          distributed between the groups. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-[clamp(11px,calc(100dvh*0.018),26px)] overflow-y-auto px-2 py-1">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.title ?? `group-${idx}`}>
            {group.title && (
              <div className="mb-[clamp(3px,calc(100dvh*0.004),7px)] px-3 pt-[clamp(2px,calc(100dvh*0.005),9px)] text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-court-sidebar-fg-dim">
                {group.title}
              </div>
            )}
            <div className="flex flex-col gap-[clamp(4px,calc(100dvh*0.006),9px)]">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  resolvedDashboardTab={resolvedDashboardTab}
                  badge={
                    item.href === "/mail"
                      ? unreadCount
                      : item.href === "/phone"
                        ? phoneUnreadCount
                        : 0
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <nav className="shrink-0 space-y-1 px-1.5 pb-1 pt-0.5">
        {FOOTER_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            resolvedDashboardTab={resolvedDashboardTab}
            badge={0}
          />
        ))}
      </nav>
      <div className="shrink-0 px-1.5 pb-1.5 pt-0.5">
        <SidebarProfileCard />
      </div>
    </aside>
  );
}

function NavLink({
  item,
  pathname,
  resolvedDashboardTab,
  badge = 0,
}: {
  item: NavItemData;
  pathname: string;
  resolvedDashboardTab: DashboardTab;
  badge?: number;
}) {
  const active = isNavItemActive({
    href: item.href,
    pathname,
    resolvedDashboardTab,
  });
  const Icon = item.icon;
  const showBadge = badge > 0;
  return (
    <Link
      href={item.href}
      className={cn(
        // Fluid row height: clamp(30px .. 40px) scaled on 100dvh, so rows
        // ride near 30px on a short laptop (every group fits, no scroll)
        // and climb to 40px on a tall monitor (the nav breathes). 13px
        // text, 16px icons throughout; tap target stays usable.
        // `isolate` so the active glow span (-z-10) layers above the row
        // background but below the icon/label without escaping the row.
        "relative isolate flex h-[clamp(30px,calc(100dvh*0.03),40px)] items-center gap-2.5 rounded-md pl-3 pr-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--court-sidebar-active-bg)] text-court-sidebar-active-fg"
          : "text-court-sidebar-fg-muted hover:bg-[var(--court-sidebar-active-bg)] hover:text-court-sidebar-fg",
      )}
    >
      {active && (
        <>
          {/* Faint command-center glow behind the active row only, in
              court-brand at low opacity. court-brand is green in every
              palette, so active nav reads green app-wide (no hex). */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 rounded-md"
            style={{
              background:
                "radial-gradient(75% 120% at 0% 50%, rgb(var(--court-brand) / 0.12), transparent 70%)",
            }}
          />
          {/* Thin court-brand left-border accent. */}
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-court-brand"
          />
        </>
      )}
      <Icon className={cn("h-4 w-4", active ? "text-court-sidebar-active-fg" : item.iconColor)} />
      <span className="flex-1">{item.label}</span>
      {showBadge && (
        <span
          aria-label={`${badge} unread`}
          className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--court-badge)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-court-badge-fg"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
