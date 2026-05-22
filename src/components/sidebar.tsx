"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  User,
  Users,
  GitBranch,
  Briefcase,
  Building2,
  Megaphone,
  Mail,
  Phone,
  Receipt,
  Calendar,
  Settings,
  StickyNote,
  BarChart3,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { SidebarProfileCard } from "@/components/sidebar-profile-card";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";

// Main nav grouped into recruiter workflow sections. Items inside a
// group are alphabetized so the eye doesn't have to learn a custom
// per-group order; the groups themselves stay in workflow order.
//   Clubhouse (ungrouped overview at top — home/dashboard surface)
//   Inbox — Mail → Phone (inbox check pinned high so unread badges read fast)
//   ATS — Applicants → Candidates → Pipeline
//   CRM — BD → Clients → Jobs
//   Ops — Calendar → Finances → Notes
//   Scoreboard — Metrics → Placements (dashboard deep-links)
type NavGroup = {
  title: string | null;
  items: ReadonlyArray<{
    href: string;
    label: string;
    icon: NavItem["icon"];
    iconColor: string;
  }>;
};

// Per-icon accent colors. Tailwind palette tokens (not raw hex) so they
// inherit theme inversion through the Court Mode setup. Used only on
// inactive nav rows — active rows keep the high-contrast sidebar
// foreground so the lit-up state still reads.
const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    title: null,
    items: [
      { href: "/dashboard", label: "Clubhouse", icon: Home, iconColor: "text-emerald-400" },
    ],
  },
  {
    title: "Inbox",
    items: [
      { href: "/mail", label: "Mail", icon: Mail, iconColor: "text-red-400" },
      { href: "/phone", label: "Phone", icon: Phone, iconColor: "text-teal-400" },
    ],
  },
  {
    title: "ATS",
    items: [
      { href: "/applicants", label: "Applicants", icon: User, iconColor: "text-amber-400" },
      { href: "/candidates", label: "Candidates", icon: Users, iconColor: "text-violet-400" },
      { href: "/pipeline", label: "Pipeline", icon: GitBranch, iconColor: "text-sky-400" },
    ],
  },
  {
    title: "CRM",
    items: [
      { href: "/bd", label: "BD", icon: Megaphone, iconColor: "text-rose-400" },
      { href: "/clients", label: "Clients", icon: Building2, iconColor: "text-cyan-400" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, iconColor: "text-indigo-400" },
    ],
  },
  {
    title: "Ops",
    items: [
      { href: "/calendar", label: "Calendar", icon: Calendar, iconColor: "text-orange-400" },
      { href: "/finances", label: "Finances", icon: Receipt, iconColor: "text-lime-400" },
      { href: "/notes", label: "Notes", icon: StickyNote, iconColor: "text-yellow-400" },
    ],
  },
  {
    title: "Scoreboard",
    items: [
      { href: "/dashboard?tab=scoreboard", label: "Metrics", icon: BarChart3, iconColor: "text-fuchsia-400" },
      { href: "/dashboard?tab=placements", label: "Placements", icon: Trophy, iconColor: "text-emerald-400" },
    ],
  },
];

// Settings is pinned to the bottom of the sidebar, visually separated
// from the main nav by a border and its own padding block. Matches the
// "account / settings drawer at the bottom" treatment used by most
// CRMs (Apollo, HubSpot, Linear).
const FOOTER_NAV = [
  { href: "/settings", label: "Settings", icon: Settings, iconColor: "text-slate-400" },
] as const;

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
      {/* One scroll region under the fixed logo holds the nav groups,
          Settings, and the profile card. Sections are top-aligned with a
          FIXED, even gap between them (space-y-5) so the rhythm is
          identical on a tall display and a short laptop — no
          justify-between, which inflated the inter-section gaps on big
          screens. Whatever height is left over collects as quiet empty
          space at the very bottom instead of as a void between sections.
          [@media(max-height:...)] tightens the gap on short laptops so
          every section still fits before scrolling. */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <nav className="space-y-5 p-2 [@media(max-height:760px)]:space-y-3 [@media(max-height:640px)]:space-y-2">
          {NAV_GROUPS.map((group, idx) => (
            <div key={group.title ?? `group-${idx}`}>
              {group.title && (
                <div className="mb-1 px-3 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-court-sidebar-fg-dim">
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
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
        <nav className="mt-1 space-y-1 border-t border-court-sidebar-border p-1.5">
          {FOOTER_NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} badge={0} />
          ))}
        </nav>
        <div className="border-t border-court-sidebar-border p-1.5">
          <SidebarProfileCard />
        </div>
      </div>
    </aside>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
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
        // Compact rows: 13px text, h-9 default, shrinks to h-7 on the
        // shortest viewports so every nav group still fits without
        // scroll. Tap target stays usable; icons stay 16px.
        // `isolate` so the active glow span (-z-10) layers above the row
        // background but below the icon/label without escaping the row.
        "relative isolate flex h-8 items-center gap-2.5 rounded-md pl-3 pr-2 text-[13px] font-medium transition-colors [@media(max-height:640px)]:h-7 [@media(max-height:640px)]:text-[12.5px]",
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
