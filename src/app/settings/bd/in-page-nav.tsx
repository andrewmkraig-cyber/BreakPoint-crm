"use client";

import { SettingsTocLink } from "@/components/settings/toc-link";

// In-page TOC for /settings/bd. The five BD-Settings sections are too
// many for the main Settings left rail (other categories ship as a
// single CollapsibleSection), so the cross-section navigation lives
// here as a horizontal pill row. SettingsTocLink takes care of both
// scrolling to the section and auto-expanding it if collapsed.
const TOC = [
  { id: "bd-engine", label: "BD Engine" },
  { id: "verticals", label: "Verticals & Searches" },
  { id: "apollo", label: "Apollo" },
  { id: "sending-domains", label: "Sending Domains" },
  { id: "daily-limits", label: "Daily Limits" },
  { id: "reply-routing", label: "Reply Routing" },
] as const;

export function BdInPageNav() {
  return (
    <nav
      aria-label="BD Settings sections"
      className="sticky top-2 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-court-border bg-court-surface/95 p-1 shadow-sm backdrop-blur"
    >
      {TOC.map((t) => (
        <SettingsTocLink
          key={t.id}
          targetId={t.id}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-court-fg-muted transition-colors hover:bg-court-surface-subtle hover:text-court-fg"
        >
          {t.label}
        </SettingsTocLink>
      ))}
    </nav>
  );
}
