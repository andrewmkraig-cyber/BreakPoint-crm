"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Inbox,
  Briefcase,
  Building2,
  Mail,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";

// Main nav in the recruiter's workflow order: Dashboard → Mail (daily
// inbox check) → Pipeline → Applicants (active work) → Candidates →
// Clients → Jobs (reference surfaces).
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/applicants", label: "Applicants", icon: Inbox },
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
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 self-start border-r border-court-border bg-white dark:bg-[#1e293b] grass:bg-[#2d4a2d] md:flex md:flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-court-border px-5">
        <BrandMark withTag />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <nav className="shrink-0 space-y-0.5 border-t border-court-border p-3">
        {FOOTER_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="shrink-0 border-t border-court-border p-4 text-[11px] uppercase tracking-wider text-court-fg-muted">
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

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-court-accent-tint text-court-accent-dark"
          // Hover uses fg-at-low-opacity so it reads as "subtle lift"
          // in all three modes — darker-than-bg in Hard (fg is
          // near-black), lighter-than-bg in Clay / Grass (fg is
          // near-white). A court-surface-subtle hover would collide
          // with the sidebar bg in Clay/Grass.
          : "text-court-fg-muted hover:bg-court-fg/5 hover:text-court-fg",
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-court-accent-dark" : "text-court-fg-muted")} />
      {item.label}
    </Link>
  );
}
