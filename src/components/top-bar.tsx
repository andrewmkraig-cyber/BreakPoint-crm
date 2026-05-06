"use client";

import { useSession } from "next-auth/react";
import { Sparkles } from "lucide-react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";
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
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleClaude}
          aria-label="Toggle Claude panel"
          aria-pressed={claudeOpen}
          className={
            "rounded-md p-2 transition hover:bg-court-surface-subtle " +
            (claudeOpen ? "text-court-brand" : "text-court-fg-muted hover:text-court-fg")
          }
        >
          <Sparkles className="h-5 w-5" />
        </button>
        <TopBarProfileCard name={user?.name ?? null} imageUrl={user?.image ?? null} />
      </div>
    </header>
  );
}
