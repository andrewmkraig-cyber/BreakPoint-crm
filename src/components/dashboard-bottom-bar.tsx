"use client";

import { WordOfDayCard } from "@/components/word-of-day-card";
import { QuoteOfDay } from "@/components/quote-of-day";
import { ChessPuzzle } from "@/components/chess-puzzle";

// Slim dashboard bottom bar: the four daily-companion chips line up
// here so the dashboard doesn't sprout one-off pills in the corner.
// Word / Quote / Chess each render their own popover anchored to
// the chip; Today's Briefing is a plain anchor scroll back up to the
// briefing section.
export function DashboardBottomBar() {
  function scrollToBriefing() {
    const node = document.getElementById("todays-briefing");
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-court-border pt-4">
      <WordOfDayCard />
      <QuoteOfDay />
      <ChessPuzzle />
      <button
        type="button"
        onClick={scrollToBriefing}
        className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        <span aria-hidden="true">📰</span>
        <span>Today&apos;s Briefing</span>
      </button>
    </div>
  );
}
