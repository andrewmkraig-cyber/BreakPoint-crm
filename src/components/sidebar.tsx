"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  User,
  Users,
  GitBranch,
  Briefcase,
  Building2,
  Mail,
  Phone,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";

// Main nav grouped into recruiter workflow sections:
//   Dashboard (ungrouped overview at top)
//   ATS — Pipeline → Applicants → Candidates (active recruiting work)
//   CRM — Clients → Jobs (reference surfaces)
//   Inbox — Mail → Phone (inbox check, sits just above Settings)
// The inbox block lives toward the bottom because the recruiter
// spends most of the day in ATS/CRM and only dips into the inbox
// when an alert pulls them there.
type NavGroup = {
  title: string | null;
  items: ReadonlyArray<{ href: string; label: string; icon: NavItem["icon"] }>;
};

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutGrid }],
  },
  {
    title: "ATS",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: GitBranch },
      { href: "/applicants", label: "Applicants", icon: User },
      { href: "/candidates", label: "Candidates", icon: Users },
    ],
  },
  {
    title: "CRM",
    items: [
      { href: "/clients", label: "Clients", icon: Building2 },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
    ],
  },
  {
    title: "Inbox",
    items: [
      { href: "/mail", label: "Mail", icon: Mail },
      { href: "/phone", label: "Phone", icon: Phone },
    ],
  },
];

// Settings is pinned to the bottom of the sidebar, visually separated
// from the main nav by a border and its own padding block. Matches the
// "account / settings drawer at the bottom" treatment used by most
// CRMs (Apollo, HubSpot, Linear).
const FOOTER_NAV = [{ href: "/settings", label: "Settings", icon: Settings }] as const;

export function Sidebar({ width }: { width?: number } = {}) {
  const pathname = usePathname();
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
        className="flex h-20 shrink-0 items-center border-b border-court-sidebar-border px-5 transition-opacity hover:opacity-80"
      >
        <BrandMark withTag />
      </Link>
      <nav className="flex-1 overflow-y-auto p-3">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.title ?? `group-${idx}`} className={idx === 0 ? "" : "mt-5"}>
            {group.title && (
              <div className="mb-1.5 flex items-center gap-2 px-3 pt-2">
                <span
                  aria-hidden="true"
                  className="h-3 w-0.5 shrink-0 rounded-full bg-court-sidebar-rail"
                />
                <div className="font-serif text-xs font-bold uppercase tracking-[0.18em] text-court-sidebar-fg-dim">
                  {group.title}
                </div>
                <div className="ml-1 h-px flex-1 bg-court-sidebar-border" />
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
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
      <nav className="shrink-0 space-y-0.5 border-t border-court-sidebar-border p-2">
        {FOOTER_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} badge={0} />
        ))}
      </nav>
    </aside>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

function NavLink({
  item,
  pathname,
  badge = 0,
}: {
  item: NavItem;
  pathname: string;
  badge?: number;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  const showBadge = badge > 0;
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-lg pl-4 pr-3 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--court-sidebar-active-bg)] text-court-sidebar-active-fg"
          : "text-court-sidebar-fg-muted hover:bg-[var(--court-sidebar-active-bg)] hover:text-court-sidebar-fg",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-court-sidebar-rail"
        />
      )}
      <Icon className={cn("h-4 w-4", active ? "text-court-sidebar-active-fg" : "text-court-sidebar-icon")} />
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
