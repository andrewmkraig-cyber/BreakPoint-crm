"use client";

import { Target } from "lucide-react";
import { CLAUDE_PILL_CLASS } from "@/components/ui/button";
import {
  useFindMatches,
  useFindMatchesActiveRoute,
  type MatchTarget,
} from "@/lib/find-matches-context";

// Trigger button that lives on the Game Plan surface (job + client
// pages). On click, opens the global FindMatchesPanel via the shared
// context. Find Matches is a Claude action under the hood, so it shares
// the canonical CLAUDE_PILL_CLASS — every "ask Claude" affordance in
// Ace renders as the same graphite-green pill.
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
      className={CLAUDE_PILL_CLASS}
    >
      <Target className="h-3 w-3" /> Find Matches
    </button>
  );
}
