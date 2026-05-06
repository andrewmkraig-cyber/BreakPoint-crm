"use client";

import { useSession } from "next-auth/react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";
import { InConversation } from "@/components/icons/in-conversation";
import { useClaudePanel } from "@/lib/claude-panel-context";
import { formatEasternWeekRange, getEasternWeekBounds } from "@/lib/week";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const { open: claudeOpen, toggle: toggleClaude } = useClaudePanel();

  // Week range replaces the previous "Wed, May 6" eyebrow — the
  // dashboard relies on this same Mon–Sun ET window for every activity
  // count, so the topbar surfaces it as the persistent context strip.
  const weekBounds = getEasternWeekBounds(new Date());
  const weekLabel = formatEasternWeekRange(weekBounds.start, weekBounds.end);

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-4 bg-court-surface px-6">
      <div className="hidden min-w-0 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted lg:flex">
        {weekLabel}
      </div>

      <div className="flex flex-1 items-center justify-end gap-3 md:flex-none md:justify-start">
        <div className="flex-1 md:flex-none md:w-96">
          <div className="rounded-lg border border-court-border bg-court-surface-subtle/60 transition focus-within:border-court-accent focus-within:bg-court-surface">
            <TopBarSearch />
          </div>
        </div>
        <ComposeFAB />
        {/* Matches ComposeFAB's icon-button vocabulary: same h-10 w-10
            footprint, same rounded-full + brand border + brand-tint
            wash, same hover lift, same focus ring. The "open" state
            inverts to a filled brand pill so the recruiter can see at
            a glance whether the panel is mounted, but the closed state
            is visually identical to the + button so they read as a
            pair, not a sticker plus a native control. */}
        <button
          type="button"
          onClick={toggleClaude}
          aria-label="Ace Assistant"
          aria-pressed={claudeOpen}
          className={
            "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
            (claudeOpen
              ? "border-court-brand-dark bg-court-brand text-white hover:bg-court-brand-dark"
              : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/30")
          }
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            Ace Assistant
          </span>
          <InConversation size={22} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <TopBarProfileCard name={user?.name ?? null} imageUrl={user?.image ?? null} />
      </div>
    </header>
  );
}
