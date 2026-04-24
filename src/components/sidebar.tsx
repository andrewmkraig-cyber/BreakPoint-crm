"use client";

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

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/applicants", label: "Applicants", icon: Inbox },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

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
    <aside className="hidden w-60 shrink-0 border-r border-court-border bg-white dark:bg-[#1e293b] grass:bg-[#2d4a2d] md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-court-border px-5">
        <BrandMark withTag />
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-court-accent-tint text-court-accent-dark"
                  // Hover uses fg-at-low-opacity so it reads as "subtle
                  // lift" in all three modes — darker-than-bg in Hard (fg
                  // is near-black), lighter-than-bg in Clay / Grass (fg
                  // is near-white). A court-surface-subtle hover would
                  // collide with the sidebar bg in Clay/Grass.
                  : "text-court-fg-muted hover:bg-court-fg/5 hover:text-court-fg",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-court-accent-dark" : "text-court-fg-muted")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-court-border p-4 text-[11px] uppercase tracking-wider text-court-fg-muted">
        BreakPoint Talent
        <div className="mt-1 text-[10px] normal-case tracking-normal text-court-fg-muted/80">
          Solon, OH &middot; Est. 2026
        </div>
      </div>
    </aside>
  );
}
