"use client";

import { Target } from "lucide-react";
import { useFindMatches, type MatchTarget } from "@/lib/find-matches-context";

// Trigger button that lives on the Game Plan surface (job + client
// pages). On click, opens the global FindMatchesPanel via the shared
// context. Kept stylistically aligned with the existing
// "Generate with Claude" black-pill buttons in the AiWorkspace
// toolbar so the two affordances feel siblings.

export function FindMatchesButton({ target }: { target: MatchTarget }) {
  const { open } = useFindMatches();
  return (
    <button
      type="button"
      onClick={() => open(target)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-court-fg px-3 py-2 text-xs font-semibold text-court-surface shadow-sm transition hover:bg-court-fg/85"
    >
      <Target className="h-3.5 w-3.5" /> Find Matches
    </button>
  );
}
