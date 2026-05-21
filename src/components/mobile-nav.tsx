"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  Briefcase,
  Calendar,
  GitBranch,
  Home,
  Mail,
  Megaphone,
  Menu,
  Phone,
  Receipt,
  Settings,
  StickyNote,
  Trophy,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mobile / narrow-viewport nav drawer. Below md the sidebar is
// `hidden md:flex` so there's no nav at all — this hamburger fills
// that gap. Click opens a left-anchored drawer with the same nav
// groups the desktop sidebar shows; route change or backdrop click
// dismisses it. Mirrors the sidebar's NAV_GROUPS rather than
// importing them so the sidebar file's other deps (mail/phone
// context, court tokens) don't get pulled into the mobile bundle.

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavGroup = {
  title: string | null;
  items: ReadonlyArray<NavItem>;
};

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Clubhouse", icon: Home }],
  },
  {
    title: "Inbox",
    items: [
      { href: "/mail", label: "Mail", icon: Mail },
      { href: "/phone", label: "Phone", icon: Phone },
    ],
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
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/clients", label: "Clients", icon: Building2 },
      { href: "/bd", label: "BD", icon: Megaphone },
    ],
  },
  {
    title: "Ops",
    items: [
      { href: "/calendar", label: "Calendar", icon: Calendar },
      { href: "/finances", label: "Finances", icon: Receipt },
      { href: "/notes", label: "Notes", icon: StickyNote },
    ],
  },
  {
    title: "Scoreboard",
    items: [
      { href: "/dashboard?tab=scoreboard", label: "Metrics", icon: BarChart3 },
      { href: "/dashboard?tab=placements", label: "Placements", icon: Trophy },
    ],
  },
  {
    title: null,
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer when the route changes — the user just navigated, no
  // reason to leave the menu hanging open over the new page. This catches
  // back/forward and programmatic nav; the per-link onClick below handles
  // the Metrics/Placements case, which only change ?tab= (same pathname)
  // and so wouldn't trip this effect on their own.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes; body scroll locks while the drawer is open so the
  // page underneath doesn't lurch when the user swipes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg transition hover:border-court-accent/40 md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-court-sidebar-border bg-court-sidebar-bg p-4 shadow-2xl md:hidden"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-serif text-lg font-bold text-court-sidebar-fg">
                Ace
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-1 text-court-sidebar-fg-muted transition hover:bg-court-sidebar-bg/40 hover:text-court-sidebar-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-4">
              {NAV_GROUPS.map((group, gi) => (
                <div key={`${gi}-${group.title ?? "ungrouped"}`}>
                  {group.title ? (
                    <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-court-sidebar-fg-dim">
                      {group.title}
                    </div>
                  ) : null}
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(pathname ?? "", item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition",
                              active
                                ? "bg-[var(--court-sidebar-active-bg)] text-court-sidebar-active-fg"
                                : "text-court-sidebar-fg hover:bg-[var(--court-sidebar-active-bg)]/60",
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </>
      )}
    </>
  );
}
