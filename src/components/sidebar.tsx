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

// Main nav in the recruiter's workflow order: Dashboard → Mail (daily
// inbox check) → Pipeline → Applicants (active work) → Candidates →
// Clients → Jobs (reference surfaces).
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/phone", label: "Phone", icon: Phone },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/applicants", label: "Applicants", icon: User },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
] as const;

// Settings is pinned to the bottom of the sidebar, visually separated
// from the main nav by a border and its own padding block. Matches the
// "account / settings drawer at the bottom" treatment used by most
// CRMs (Apollo, HubSpot, Linear).
const FOOTER_NAV = [{ href: "/settings", label: "Settings", icon: Settings }] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { unreadCount } = useMailContext();
  const { unreadCount: phoneUnreadCount } = usePhoneContext();

  return (
    // Sidebar background is mode-aware: Hard = white (unchanged from
    // legacy), Clay = #1e293b (slate-800, "lifted" over body's #0f172a),
    // Grass = #2d4a2d (mid-green, lifted over body's #1a2e1a). Using
    // explicit dark:/grass: hex overrides rather than a court-* token
    // because this surface wants the *subtle* shade in Clay/Grass while
    // still being pure white in Hard — no single existing token matches
    // that across all three modes.
    // Sticky positioning + h-screen makes the sidebar always visible as
    // the page content scrolls. self-start anchors it to the top of the
    // flex parent so its height stays bounded by the viewport instead
    // of stretching to match the (potentially much taller) page. The
    // main-nav block gets its own internal scroll so the Settings
    // footer + brand blurb stay pinned at the bottom of the sidebar
    // even on viewports too short to fit every nav item.
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 self-start border-r border-court-border bg-court-surface grass:bg-[#1F3A1F] md:flex md:flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-court-border px-5">
        <BrandMark withTag />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map((item) => (
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
      </nav>
      <nav className="shrink-0 space-y-0.5 border-t border-court-border p-2">
        {FOOTER_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} badge={0} />
        ))}
      </nav>
      <div className="shrink-0 border-t border-court-border p-3 text-[11px] uppercase tracking-wider text-court-fg-muted">
        BreakPoint Talent
        <div className="mt-1 text-[10px] normal-case tracking-normal text-court-fg-muted/80">
          Solon, OH &middot; Est. 2026
        </div>
      </div>
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
  // Per design rules: green is a scalpel, not a paint bucket. The
  // unread badge uses the BreakPoint green token (#5A9642) for a
  // positive-status chip — one of the four sanctioned green use cases.
  const showBadge = badge > 0;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-12 items-center gap-3 rounded-xl border px-4 text-sm font-medium transition-colors",
        active
          ? "border-court-accent/40 bg-court-accent-tint text-court-accent-dark shadow-sm"
          : "border-transparent bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle grass:bg-transparent grass:text-[#C8D8C0] grass:hover:bg-[#2A4A2A]",
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-court-accent-dark" : "text-court-fg-muted")} />
      <span className="flex-1">{item.label}</span>
      {showBadge && (
        <span
          aria-label={`${badge} unread`}
          className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-brand grass:bg-grass-purple px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
