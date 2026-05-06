"use client";

import { useSession } from "next-auth/react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";
import { InConversation } from "@/components/icons/in-conversation";
import { useClaudePanel } from "@/lib/claude-panel-context";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const { open: claudeOpen, toggle: toggleClaude } = useClaudePanel();

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-4 bg-court-surface px-6">
      <div className="hidden min-w-0 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted lg:flex">
        {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </div>

      <div className="flex flex-1 items-center justify-end gap-3 md:flex-none md:justify-start">
        <div className="flex-1 md:flex-none md:w-96">
          <div className="rounded-lg border border-court-border bg-court-surface-subtle/60 transition focus-within:border-court-accent focus-within:bg-court-surface">
            <TopBarSearch />
          </div>
        </div>
        <ComposeFAB />
        <button
          type="button"
          onClick={toggleClaude}
          aria-label="Toggle Claude panel"
          aria-pressed={claudeOpen}
          className={
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-court-surface-subtle " +
            (claudeOpen ? "text-court-brand" : "text-court-fg-muted hover:text-court-fg")
          }
        >
          <InConversation size={28} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <TopBarProfileCard name={user?.name ?? null} imageUrl={user?.image ?? null} />
      </div>
    </header>
  );
}
