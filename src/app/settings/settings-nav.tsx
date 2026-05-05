"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Category list lives here so layout.tsx (server component) and the
// nav (client component) share the same source of truth.
//
// Order: setup-y items first, the catch-all live-health Connectors
// panel last. Email Preferences was removed — phone + signature are
// owned by Branding now, and the auto-send trigger moved into
// Templates/Triggers.
export const SETTINGS_CATEGORIES = [
  { slug: "appearance",        label: "Appearance" },
  { slug: "notifications",     label: "Notifications" },
  { slug: "personal-trainer",  label: "Personal Trainer" },
  { slug: "branding",          label: "Branding" },
  { slug: "templates",         label: "Templates/Triggers" },
  { slug: "connectors",        label: "Connectors" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      {SETTINGS_CATEGORIES.map((c) => {
        const href = `/settings/${c.slug}`;
        // Match exact path OR a deeper sub-route under the same
        // category, so future nested routes (e.g.
        // /settings/templates/[id]) keep their parent active.
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={c.slug}
            href={href}
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
  );
}
