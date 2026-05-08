"use client";

import { useEffect, useRef, useState } from "react";

// Compact "Chess Puzzle" pill that lives next to the Word of the Day
// pill at the bottom of the dashboard. Renders a single-line chip;
// clicking expands a popover above the pill with today's Lichess
// puzzle metadata and a button that opens the puzzle in a new tab.
//
// Lichess returns the same daily puzzle for everyone all day, so we
// fetch directly from the browser (no API key, no caching layer).
// Outside-click + Escape close the popover.

type LichessDailyResponse = {
  puzzle?: {
    id?: string;
    rating?: number;
    plays?: number;
    initialPly?: number;
    solution?: string[];
    themes?: string[];
  };
};

type Puzzle = {
  id: string;
  rating: number;
  themes: string[];
  movesInSolution: number;
};

// Lichess theme keys are camelCase ("kingsideAttack"). Split them and
// title-case so they render as "Kingside Attack" in the popover.
function formatTheme(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ChessPuzzle() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [open, setOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("https://lichess.org/api/puzzle/daily", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as LichessDailyResponse;
        if (cancelled) return;
        const id = json.puzzle?.id;
        if (!id) return;
        setPuzzle({
          id,
          rating: json.puzzle?.rating ?? 0,
          themes: json.puzzle?.themes ?? [],
          movesInSolution: (json.puzzle?.solution ?? []).length,
        });
      } catch {
        // Silent fail — pill renders nothing rather than an error
        // state so the dashboard's bottom row stays clean for users
        // when Lichess is briefly unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!puzzle) return null;

  // Cap themes at three so a long list doesn't push the popover tall.
  const formattedThemes = puzzle.themes.slice(0, 3).map(formatTheme).join(", ");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-full border border-court-border px-3 py-1 text-xs text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        <span
          aria-hidden="true"
          className="text-sm leading-none text-court-fg"
        >
          ♞
        </span>
        <span className="uppercase tracking-wider text-[10px]">
          Chess Puzzle
        </span>
        <span aria-hidden="true">→</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Today's chess puzzle"
          className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Today&apos;s Puzzle
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-stat text-xl font-bold leading-tight text-court-fg">
              {puzzle.rating}
            </div>
            <div className="text-xs italic text-court-fg-muted">rating</div>
          </div>
          {formattedThemes && (
            <div className="mt-2 text-sm text-court-fg">{formattedThemes}</div>
          )}
          <div className="mt-2 text-xs italic leading-relaxed text-court-fg-muted">
            {puzzle.movesInSolution}{" "}
            {puzzle.movesInSolution === 1 ? "move" : "moves"} in solution
          </div>
          <a
            href={`https://lichess.org/training/${puzzle.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-court-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-court-brand-dark"
          >
            Open Puzzle
          </a>
        </div>
      )}
    </div>
  );
}
