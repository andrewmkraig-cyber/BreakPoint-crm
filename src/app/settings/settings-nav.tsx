"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Category list lives here so layout.tsx (server component) and the
// nav (client component) share the same source of truth.
//
// Order: Appearance + Notifications first, then the live-health
// Connectors panel, then BD Engine right after it, then the email
// workflow panels (Bulk Email Pacing above Templates + Triggers), then
// housekeeping. Personal Trainer sits near the bottom above Claude
// History (rarely visited). Email Preferences was removed; phone +
// signature are owned by Branding now, and the auto-send trigger moved
// into Templates/Triggers. "Personal Info" and "Branding" merged into
// one entry — both forms now render on the /settings/personal-info page
// with brand below personal info. Bulk email pacing was split out of
// /settings/templates into its own category.
export const SETTINGS_CATEGORIES = [
  { slug: "appearance",        label: "Appearance" },
  { slug: "notifications",     label: "Notifications" },
  { slug: "connectors",        label: "Connectors" },
  { slug: "bd",                label: "BD Engine" },
  { slug: "bulk-email",        label: "Bulk Email Pacing" },
  { slug: "templates",         label: "Templates + Triggers" },
  { slug: "billing",           label: "Billing" },
  { slug: "personal-info",     label: "Personal Info + Brand" },
  { slug: "personal-trainer",  label: "Personal Trainer" },
  { slug: "history",           label: "Claude History" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  // Match exact path OR a deeper sub-route under the same category, so
  // future nested routes (e.g. /settings/templates/[id]) keep their
  // parent active. Same predicate for both renderings below.
  function isActive(slug: string): boolean {
    const href = `/settings/${slug}`;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Mobile (< lg): horizontal scrollable pill strip. Mirrors the
          MobileBucketTabs pattern from /phone — all categories stay
          reachable on a 375px viewport via overflow-x scroll, no
          wrapping. Hidden at lg+ where the vertical sidebar takes
          over. */}
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden"
      >
        {SETTINGS_CATEGORIES.map((c) => {
          const active = isActive(c.slug);
          return (
            <Link
              key={c.slug}
              href={`/settings/${c.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center rounded-md border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
                  : "border-court-border bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle",
              )}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop (lg+): vertical stacked nav with left-rail accent.
          Unchanged from the original layout. */}
      <nav aria-label="Settings sections" className="hidden space-y-0.5 lg:block">
        {SETTINGS_CATEGORIES.map((c) => {
          const active = isActive(c.slug);
          return (
            <Link
              key={c.slug}
              href={`/settings/${c.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block border-l-2 px-3 py-2 text-sm font-medium transition",
                active
                  ? "border-court-accent bg-court-surface-subtle text-court-fg"
                  : "border-transparent text-court-fg-muted hover:bg-court-surface-subtle/60 hover:text-court-fg",
              )}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
