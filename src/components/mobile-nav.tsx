"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandDisc } from "@/components/brand-mark";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";
import { useCourtMode } from "@/lib/court-mode";
import { isNavItemActive, resolveDashboardTab } from "@/components/nav-active";
import { NAV_GROUPS, FOOTER_NAV, type NavItemData } from "@/components/nav-items";

// Mobile / narrow-viewport nav drawer. Below md the sidebar is
// `hidden md:flex` so there's no nav at all — this hamburger fills
// that gap. Click opens a left-anchored drawer with the same nav
// groups the desktop sidebar shows; route change or backdrop click
// dismisses it. NAV_GROUPS + FOOTER_NAV (including the per-item rainbow
// iconColor) are imported from the shared @/components/nav-items source
// so desktop + mobile stay in lockstep and the icon colors can never
// drift. Settings is pinned at the bottom (FOOTER_NAV), above the
// Light/Dark toggle.
//
// Mail/Phone unread DO read from the shared MailContext/PhoneContext
// (same source the desktop sidebar uses) so the installed iPhone PWA,
// which only ever sees this hamburger nav, gets the same Mail + text
// unread badges the desktop sidebar shows. TopBar (which renders this)
// mounts inside both providers in app-shell, so the live counts flow
// here, not the providers' static-zero fallback.

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Mirror the desktop sidebar's tab-aware active state. /dashboard?tab=
  // routes all share the pathname /dashboard, so we discriminate via the
  // resolved dashboard tab — see src/components/nav-active.ts.
  const searchParams = useSearchParams();
  const resolvedDashboardTab = resolveDashboardTab(searchParams?.get("tab"));
  // Live unread counts, same context the desktop sidebar reads. Mail =
  // unread Gmail threads; Phone = unread inbound text threads (calls do
  // not contribute — CallLog has no read state). Total drives the
  // hamburger overlay so the recruiter sees inbox activity before
  // opening the drawer.
  const { unreadCount: mailUnread } = useMailContext();
  const { unreadCount: phoneUnread } = usePhoneContext();
  const totalUnread = mailUnread + phoneUnread;
  // Light/Dark toggle - PWA only. The desktop topbar carries this control;
  // on mobile it lives in this drawer (below Settings) so the topbar icon
  // row stays on one line. Flips only the Light/Dark axis on the active
  // court; the surface (Hard/Clay/Grass/Night) is untouched.
  const { theme, toggleTheme } = useCourtMode();

  // One row renderer for both the workflow groups and the pinned Settings
  // (FOOTER_NAV), so the rainbow + badge + active-state logic lives in a
  // single place. Inactive rows carry the shared per-item iconColor (the
  // same map the desktop sidebar uses); the active row drops it so the
  // icon inherits the high-contrast active foreground.
  const renderNavRow = (item: NavItemData) => {
    const Icon = item.icon;
    const active = isNavItemActive({
      href: item.href,
      pathname: pathname ?? "",
      resolvedDashboardTab,
    });
    // Same badge wiring as the desktop sidebar: Mail shows unread threads,
    // Phone shows unread texts, everything else has no badge.
    const badge =
      item.href === "/mail"
        ? mailUnread
        : item.href === "/phone"
          ? phoneUnread
          : 0;
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
          <Icon className={cn("h-4 w-4 shrink-0", !active && item.iconColor)} />
          <span className="flex-1">{item.label}</span>
          {badge > 0 && (
            <span
              aria-label={`${badge} unread`}
              className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--court-badge)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-court-badge-fg"
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Link>
      </li>
    );
  };

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
        aria-label={
          totalUnread > 0
            ? `Open navigation menu, ${totalUnread} unread`
            : "Open navigation menu"
        }
        aria-expanded={open}
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-court-border bg-court-surface text-court-fg transition hover:border-court-accent/40 md:hidden"
      >
        <Menu className="h-5 w-5" />
        {/* Total inbox-activity overlay: mail + text unread combined, so
            the recruiter sees there's something waiting before opening the
            drawer. Same Court badge tokens as the in-drawer item badges;
            count is announced via the button's aria-label so this stays
            aria-hidden. */}
        {totalUnread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 inline-flex min-w-[17px] items-center justify-center rounded-full bg-[var(--court-badge)] px-1 py-0.5 text-[9px] font-semibold leading-none text-court-badge-fg"
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {/* Portal the drawer to <body>: TopBar (which renders this) is a
          sticky, backdrop-blurred header, and BOTH sticky+z-index AND
          backdrop-filter establish a stacking context. Rendered inline
          the drawer is trapped inside that context at the header's z-30,
          so dashboard content with its own higher stacking contexts
          paints over it — the "hamburger stuck behind the dashboard" bug
          on the installed PWA. Portaling to document.body lifts it to the
          root stacking context; z-[1100]/z-[1101] matches the app's
          slide-in drawer band so it sits above page content. The block
          only renders once open (false during SSR / first paint), so
          there's no hydration mismatch from the document guard. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[1100] bg-black/50 backdrop-blur-sm md:hidden"
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-[1101] flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-court-sidebar-border bg-court-sidebar-bg p-4 shadow-2xl md:hidden"
            >
            <div className="mb-4 flex items-center justify-between">
              {/* Serve-Arc disc + wordmark, matching the topbar lockup so
                  the drawer header carries the same brand mark the
                  installed PWA shows up top. BrandDisc is the same mark
                  the topbar/sidebar render. */}
              <div className="flex items-center gap-2.5">
                <BrandDisc />
                <span className="font-serif text-lg font-bold text-court-sidebar-fg">
                  Ace
                </span>
              </div>
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
                    {group.items.map((item) => renderNavRow(item))}
                  </ul>
                </div>
              ))}
              {/* Settings, pinned below the workflow groups (shared
                  FOOTER_NAV), above the Light/Dark toggle. */}
              <ul className="flex flex-col gap-0.5">
                {FOOTER_NAV.map((item) => renderNavRow(item))}
              </ul>
              {/* Light/Dark toggle - sits below Settings. Mirrors the nav
                  item chrome but is a button (toggles theme, no navigation).
                  Drawer stays open so the user sees the theme flip apply. */}
              <button
                type="button"
                onClick={() => toggleTheme()}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-court-sidebar-fg transition hover:bg-[var(--court-sidebar-active-bg)]/60"
              >
                {theme === "light" ? (
                  <Moon className="h-4 w-4 shrink-0" />
                ) : (
                  <Sun className="h-4 w-4 shrink-0" />
                )}
                <span className="flex-1 text-left">
                  {theme === "light" ? "Dark Mode" : "Light Mode"}
                </span>
              </button>
            </nav>
          </aside>
          </>,
          document.body,
        )}
    </>
  );
}
