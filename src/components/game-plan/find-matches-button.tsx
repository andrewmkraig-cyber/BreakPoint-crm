"use client";

import { Search } from "lucide-react";
import {
  useFindMatches,
  useFindMatchesActiveRoute,
  type MatchTarget,
} from "@/lib/find-matches-context";

// Gold/amber outlined "magnifying glass" search affordance. Find Matches
// is a search/sourcing action, so it reads as a distinct gold search pill
// rather than the graphite-green Claude pill the rest of the "ask Claude"
// affordances use. Tailwind amber ramp tokens only (border + text amber-
// 500/400, amber-50 hover) - NOT the reserved #F59E0B Launch-BD-Run hex
// (ACE_DESIGN Color Discipline). rounded-md + px-3 py-2 text-xs sizing
// mirrors CLAUDE_PILL_CLASS so swapping the style doesn't shift layout.
// Verified in both light and dark Court modes.
const FIND_MATCHES_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-amber-500 bg-transparent px-3 py-2 text-xs font-semibold text-amber-600 shadow-sm transition hover:bg-amber-50 dark:border-amber-400 dark:text-amber-300 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:cursor-not-allowed disabled:opacity-60";

// Trigger button that lives on the Game Plan surface (job + client
// pages). On click, opens the global FindMatchesPanel via the shared
// context.
//
// Side effect: the button also announces its entity as the current
// route's Game Plan target (useFindMatchesActiveRoute) so the panel's
// route-aware render gate can hide/restore correctly when the user
// navigates between entities.

export function FindMatchesButton({ target }: { target: MatchTarget }) {
  const { open } = useFindMatches();
  useFindMatchesActiveRoute(target);
  return (
    <button
      type="button"
      onClick={() => open(target)}
      className={FIND_MATCHES_BUTTON_CLASS}
    >
      <Search className="h-3 w-3" /> Find Matches
    </button>
  );
}
