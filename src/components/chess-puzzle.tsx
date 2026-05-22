"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

// Interactive Lichess puzzle in the 1000-1500 rating band, shared
// across the org. The puzzle is selected once per (org, ET day) by
// /api/chess-puzzle, which hits Lichess and persists the result so
// every recruiter in the org sees the same board. Streak state lives
// in Neon (per user, not per browser) so the day count follows the
// recruiter across devices — iPad and laptop now share one row.
//
// Convention: solution[0] is the user's first move (FEN side-to-move
// == user's color); odd-indexed moves are auto-played by the opponent.

type Puzzle = {
  id: string;
  rating: number;
  fen: string;
  solution: string[];
  themes: string[];
};

type ChessPuzzleApiResponse = {
  ok: boolean;
  cached?: boolean;
  puzzle?: Puzzle;
  error?: string;
};

type Status =
  | "playing"
  | "wrong"
  | "solved"
  // Set on mount when localStorage shows the user already solved
  // cleanly today — board is locked, banner says "Nice job".
  | "already-solved"
  // Set on mount when failedDate stamped today — streak is gone for
  // the day, board is locked, banner says "try again tomorrow".
  | "streak-failed";

type UciMove = { from: Square; to: Square; promotion?: string };

// Legacy localStorage keys, retained for one-shot migration only. New
// reads/writes go through /api/chess-puzzle/streak so the state follows
// the user across devices. Once a browser has run the migration its
// keys are cleared and never written again.
const STREAK_KEY = "ace.chess.streak";
const LAST_SOLVED_KEY = "ace.chess.lastSolvedDate";
const FAILED_DATE_KEY = "ace.chess.failedDate";

type StreakSnapshot = {
  streak: number;
  lastSolvedDate: string | null;
  failedDate: string | null;
};

type StreakApiResponse =
  | ({ ok: true } & StreakSnapshot)
  | { ok: false; error: string };

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function yesterdayET(): string {
  const todayUtcStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayUtcStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function readLegacyLocalStreak(): StreakSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STREAK_KEY);
  const lastSolvedDate = window.localStorage.getItem(LAST_SOLVED_KEY);
  const failedDate = window.localStorage.getItem(FAILED_DATE_KEY);
  if (raw == null && !lastSolvedDate && !failedDate) return null;
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return {
    streak: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    lastSolvedDate,
    failedDate,
  };
}

function clearLegacyLocalStreak() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STREAK_KEY);
  window.localStorage.removeItem(LAST_SOLVED_KEY);
  window.localStorage.removeItem(FAILED_DATE_KEY);
}

async function fetchStreak(): Promise<StreakSnapshot | null> {
  try {
    const res = await fetch("/api/chess-puzzle/streak", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as StreakApiResponse;
    if (!json.ok) return null;
    return {
      streak: json.streak,
      lastSolvedDate: json.lastSolvedDate,
      failedDate: json.failedDate,
    };
  } catch {
    return null;
  }
}

async function postStreak(body: {
  streak: number;
  lastSolvedDate?: string | null;
  failedDate?: string | null;
}): Promise<StreakSnapshot | null> {
  try {
    const res = await fetch("/api/chess-puzzle/streak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as StreakApiResponse;
    if (!json.ok) return null;
    return {
      streak: json.streak,
      lastSolvedDate: json.lastSolvedDate,
      failedDate: json.failedDate,
    };
  } catch {
    return null;
  }
}

function parseUci(uci: string): UciMove {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export function ChessPuzzle() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Popover ref drives the on-open scrollIntoView so the popover is
  // never clipped above the viewport when the recruiter opens a chip
  // after scrolling down. Without this, the chess board (the tallest
  // popover) was opening above the visible area and forcing a manual
  // scroll up.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Drag offset from centered position. Reset to {0,0} on each open so
  // the dialog reappears centered after a close.
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const dragStartRef = useRef<
    { startX: number; startY: number; baseX: number; baseY: number } | null
  >(null);

  function onDialogMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // Don't start a drag from interactive descendants — the close X,
    // the chessboard, the Lichess link, etc.
    if (
      target.closest(
        "button, a, input, [data-piece], [data-square], .react-chessboard, [role=button]",
      )
    ) {
      return;
    }
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: dragPos.x,
      baseY: dragPos.y,
    };
    function onMove(ev: MouseEvent) {
      const s = dragStartRef.current;
      if (!s) return;
      setDragPos({
        x: s.baseX + (ev.clientX - s.startX),
        y: s.baseY + (ev.clientY - s.startY),
      });
    }
    function onUp() {
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    // Server route is authoritative — picks once per (org, ET day) and
    // caches in Neon, so every recruiter in the org lands on the same
    // board. No client-side localStorage cache here on purpose: a
    // stale per-browser copy would diverge from the org-shared row
    // after midnight ET.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chess-puzzle", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ChessPuzzleApiResponse;
        if (cancelled) return;
        if (!json.ok || !json.puzzle) return;
        setPuzzle(json.puzzle);
      } catch {
        // Silent — pill stays hidden if the API is unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      // Reset drag offset on close so the next open re-centers.
      setDragPos({ x: 0, y: 0 });
      return;
    }
    // The chess popover is ~470px tall (header + 320px board + footer).
    // block: "nearest" only scrolls when strictly necessary, which for
    // an element bigger than the viewport's available space leaves the
    // top clipped. block: "start" guarantees the popover top lands at
    // the top of the visible scroll area, so the rating chip / heading
    // are always readable. Combined with max-h on the popover itself,
    // overflow gets handled gracefully on short viewports.
    const rafId = window.requestAnimationFrame(() => {
      popoverRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!puzzle) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 hover:text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
      >
        {/* Inline chess-king silhouette — the previous unicode pawn
            glyph (♟) wasn't rendering as a chess piece on Andrew's
            stack (it fell through to a generic triangle), so we ship
            our own path. currentColor lets the chip's text color
            tint the icon. */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          fill="currentColor"
        >
          <path d="M11 2v2H9v2h2v2H8.5A2.5 2.5 0 0 0 6 10.5v.4c0 1.4.6 2.7 1.7 3.6l1.3 1.1V18H7v3h10v-3h-2v-2.4l1.3-1.1A4.6 4.6 0 0 0 18 10.9v-.4A2.5 2.5 0 0 0 15.5 8H13V6h2V4h-2V2h-2zM9 19h6v1H9v-1z" />
        </svg>
        <span className="truncate">Daily Chess Puzzle</span>
      </button>

      {open && (
        <>
          {/* Backdrop — clicking dismisses the modal. position:fixed
              so the chess popover is no longer anchored to the chip's
              location (which was clipping the top when the chip sat
              near the top of the viewport). */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-label="Chess puzzle"
            style={{
              transform: `translate(calc(-50% + ${dragPos.x}px), calc(-50% + ${dragPos.y}px))`,
            }}
            className="fixed left-1/2 top-1/2 z-50 w-[360px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-court-border bg-court-surface px-4 pb-4 pt-2 shadow-2xl dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.4)]"
          >
            {/* Drag handle — small grip bar at the top of the dialog so
                the user can reposition the puzzle. Sized to clear the
                close X (top-2 right-2) without overlapping it. */}
            <div
              onMouseDown={onDialogMouseDown}
              aria-hidden="true"
              className="-mx-4 mb-1 flex h-5 cursor-move items-center justify-center pr-8"
            >
              <div className="h-1 w-10 rounded-full bg-court-border" />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-2 top-2 z-10 rounded-md p-0.5 text-court-fg-muted opacity-60 transition hover:bg-court-surface-subtle hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <PuzzleBoard puzzle={puzzle} />
          </div>
        </>
      )}
    </div>
  );
}

function PuzzleBoard({ puzzle }: { puzzle: Puzzle }) {
  // chess.js instance is mutable — store in a ref and mirror its FEN
  // to component state so react-chessboard re-renders on each move.
  const gameRef = useRef<Chess>(new Chess(puzzle.fen));
  const [fen, setFen] = useState<string>(puzzle.fen);
  const [moveIdx, setMoveIdx] = useState<number>(0);
  const [status, setStatus] = useState<Status>("playing");
  const [flash, setFlash] = useState<"green" | "red" | null>(null);
  const [hintActive, setHintActive] = useState<boolean>(false);
  const [streak, setStreak] = useState<number>(0);
  // History stack of pre-move FEN snapshots (paired with moveIdx) so
  // the Back button can step the recruiter back one move-pair at a
  // time when they lose track of where they are mid-puzzle.
  const [history, setHistory] = useState<{ fen: string; moveIdx: number }[]>(
    [],
  );
  // Click-to-move support: track which square was tapped first so the
  // next click on a legal target completes the move. Drag still works
  // independently of this state.
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  // Pending timers — opponent's 500ms reply and the showAnswer
  // animation step. Tracked so Back can cancel them and avoid
  // racing a stale move into a rolled-back position.
  const oppTimeoutRef = useRef<number | null>(null);
  const answerTimeoutRef = useRef<number | null>(null);

  // Mirror the server's lastSolvedDate / failedDate into refs so the
  // status-transition effect reads the freshest values without needing
  // them in its dependency array. The same refs gate same-day re-solve
  // credit and seed the consecutive-day check on the next solve.
  const lastSolvedRef = useRef<string | null>(null);
  const failedRef = useRef<string | null>(null);
  // Holds back the solve/fail POSTs until after the GET completes so a
  // race between status churn and the initial hydration can't write 0
  // over a real server-side streak.
  const hydratedRef = useRef<boolean>(false);

  // Hydrate streak + terminal-day status from the server on mount. A
  // GET that comes back empty AND a non-empty legacy localStorage row
  // triggers a one-shot migration POST so existing streaks (Andrew's
  // 2-day count from the laptop) survive the cutover. Once migrated,
  // the localStorage keys are cleared so future devices read from the
  // server only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let snap = await fetchStreak();
      if (cancelled) return;
      const emptyServer =
        !snap ||
        (snap.streak === 0 && !snap.lastSolvedDate && !snap.failedDate);
      if (emptyServer) {
        const legacy = readLegacyLocalStreak();
        const legacyHasData =
          legacy &&
          (legacy.streak > 0 || legacy.lastSolvedDate || legacy.failedDate);
        if (legacy && legacyHasData) {
          const migrated = await postStreak({
            streak: legacy.streak,
            lastSolvedDate: legacy.lastSolvedDate,
            failedDate: legacy.failedDate,
          });
          if (cancelled) return;
          if (migrated) {
            snap = migrated;
            clearLegacyLocalStreak();
          }
        }
      }
      if (cancelled) return;
      const safe: StreakSnapshot = snap ?? {
        streak: 0,
        lastSolvedDate: null,
        failedDate: null,
      };
      setStreak(safe.streak);
      lastSolvedRef.current = safe.lastSolvedDate;
      failedRef.current = safe.failedDate;
      const today = todayET();
      if (safe.failedDate === today) {
        setStatus("streak-failed");
      } else if (safe.lastSolvedDate === today) {
        setStatus("already-solved");
      }
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Effect-driven streak updates: status is the only signal, so the
  // useEffect runs once per transition into "wrong" or "solved". POSTs
  // go to the API; refs mirror the new server state so the next
  // transition reads fresh values without waiting for a GET.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (status === "wrong") {
      const today = todayET();
      setStreak(0);
      failedRef.current = today;
      void postStreak({ streak: 0, failedDate: today });
      return;
    }
    if (status === "solved") {
      const today = todayET();
      if (failedRef.current === today) return; // wrong move earlier today — no credit
      if (lastSolvedRef.current === today) return; // already credited today
      const next = lastSolvedRef.current === yesterdayET() ? streak + 1 : 1;
      setStreak(next);
      lastSolvedRef.current = today;
      void postStreak({ streak: next, lastSolvedDate: today });
    }
    // streak intentionally omitted from deps — solve/fail re-runs are
    // status-driven; reading streak fresh at execution time is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // User's color comes from the initial side-to-move; orient the
  // board that way so up-the-board attacks always read intuitively.
  const userColor: "white" | "black" = useMemo(() => {
    return new Chess(puzzle.fen).turn() === "w" ? "white" : "black";
  }, [puzzle.fen]);

  function flashFor(color: "green" | "red") {
    setFlash(color);
    window.setTimeout(() => setFlash(null), 450);
  }

  function autoPlayOpponent(idx: number) {
    if (idx >= puzzle.solution.length) {
      setStatus("solved");
      return;
    }
    const opp = parseUci(puzzle.solution[idx]);
    oppTimeoutRef.current = window.setTimeout(() => {
      oppTimeoutRef.current = null;
      try {
        gameRef.current.move(opp);
        setFen(gameRef.current.fen());
      } catch {
        // Solution string didn't parse cleanly — bail to "solved" so
        // the player isn't stuck. Realistic only if Lichess data is
        // malformed for the day.
        setStatus("solved");
        return;
      }
      const after = idx + 1;
      setMoveIdx(after);
      if (after >= puzzle.solution.length) setStatus("solved");
    }, 500);
  }

  function onPieceDrop(source: string, target: string): boolean {
    // Block any move once the day is settled — solved cleanly,
    // already-solved on a prior visit, or streak-failed earlier today.
    if (
      status === "solved" ||
      status === "already-solved" ||
      status === "streak-failed"
    ) {
      return false;
    }
    setHintActive(false);
    setSelectedSquare(null);

    const expected = parseUci(puzzle.solution[moveIdx]);
    const promotion = expected.from === source && expected.to === target
      ? expected.promotion ?? "q"
      : "q";

    // Validate against chess.js without committing first — a
    // committed-then-undone move re-emits state churn we don't need.
    const probe = new Chess(gameRef.current.fen());
    let move;
    try {
      move = probe.move({ from: source, to: target, promotion });
    } catch {
      return false;
    }
    if (!move) return false;

    const isMatch =
      move.from === expected.from &&
      move.to === expected.to &&
      (move.promotion ?? "") === (expected.promotion ?? "");

    if (!isMatch) {
      setStatus("wrong");
      flashFor("red");
      return false;
    }

    // Snapshot the pre-move state before committing so Back can
    // restore exactly where the recruiter was, including the moveIdx
    // pointer into the solution array.
    setHistory((h) => [
      ...h,
      { fen: gameRef.current.fen(), moveIdx },
    ]);

    // Match — commit on the real game and advance the index.
    gameRef.current.move({ from: source, to: target, promotion });
    setFen(gameRef.current.fen());
    flashFor("green");
    const next = moveIdx + 1;
    setMoveIdx(next);
    setStatus("playing");
    if (next >= puzzle.solution.length) {
      setStatus("solved");
    } else {
      autoPlayOpponent(next);
    }
    return true;
  }

  // Tap-to-select then tap-to-move. Mirrors the drag flow through
  // onPieceDrop so validation/snapshot/auto-reply logic stays in one
  // place. Tapping the same square twice clears the selection;
  // tapping an empty/opponent square either re-selects (if it's the
  // recruiter's piece) or just clears.
  function onSquareClick(square: string) {
    if (status === "solved") return;
    const sq = square as Square;
    if (selectedSquare && selectedSquare !== sq) {
      const moved = onPieceDrop(selectedSquare, sq);
      if (moved) return;
      // Drop failed (illegal or wrong solution move). Fall through so
      // a click on another own-piece reselects instead of leaving
      // them stuck on the prior selection.
    }
    if (selectedSquare === sq) {
      setSelectedSquare(null);
      return;
    }
    const piece = gameRef.current.get(sq);
    if (piece && piece.color === gameRef.current.turn()) {
      setSelectedSquare(sq);
    } else {
      setSelectedSquare(null);
    }
  }

  // Step back one move-pair: pop the latest snapshot, reload the
  // chess.js game, and cancel any pending opponent / show-answer
  // timer so it can't race a move onto the rolled-back board.
  function goBack() {
    if (history.length === 0) return;
    if (oppTimeoutRef.current !== null) {
      window.clearTimeout(oppTimeoutRef.current);
      oppTimeoutRef.current = null;
    }
    if (answerTimeoutRef.current !== null) {
      window.clearTimeout(answerTimeoutRef.current);
      answerTimeoutRef.current = null;
    }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    gameRef.current = new Chess(prev.fen);
    setFen(prev.fen);
    setMoveIdx(prev.moveIdx);
    setStatus("playing");
    setHintActive(false);
    setSelectedSquare(null);
    setFlash(null);
  }

  function showHint() {
    setHintActive(true);
    setStatus("playing");
  }

  // Show Answer plays the remaining solution out for the user, with
  // a small delay between each move so the sequence is readable.
  function showAnswer() {
    setHintActive(false);
    setSelectedSquare(null);
    let idx = moveIdx;
    const step = () => {
      answerTimeoutRef.current = null;
      if (idx >= puzzle.solution.length) {
        setStatus("solved");
        return;
      }
      const m = parseUci(puzzle.solution[idx]);
      try {
        gameRef.current.move(m);
        setFen(gameRef.current.fen());
      } catch {
        setStatus("solved");
        return;
      }
      idx += 1;
      setMoveIdx(idx);
      answerTimeoutRef.current = window.setTimeout(step, 550);
    };
    step();
  }

  // Hint highlight: source square of the next solution move in yellow.
  // Flash uses the wrapping ring; render it on the board container.
  const customSquareStyles: Record<string, React.CSSProperties> = {};
  if (hintActive && status !== "solved" && moveIdx < puzzle.solution.length) {
    const expected = parseUci(puzzle.solution[moveIdx]);
    customSquareStyles[expected.from] = {
      boxShadow: "inset 0 0 0 4px rgba(234, 179, 8, 0.85)",
    };
  }
  // Click-to-move highlights: blue ring on the selected source plus
  // soft dots on every legal destination so the recruiter can see
  // where the piece can land before committing.
  if (selectedSquare && status !== "solved") {
    customSquareStyles[selectedSquare] = {
      ...(customSquareStyles[selectedSquare] ?? {}),
      boxShadow: "inset 0 0 0 4px rgba(37, 99, 235, 0.95)",
    };
    let legal: { to: string }[] = [];
    try {
      legal = gameRef.current.moves({
        square: selectedSquare,
        verbose: true,
      }) as { to: string }[];
    } catch {
      legal = [];
    }
    for (const m of legal) {
      customSquareStyles[m.to] = {
        ...(customSquareStyles[m.to] ?? {}),
        background:
          "radial-gradient(circle, rgba(37, 99, 235, 0.6) 25%, transparent 26%)",
      };
    }
  }

  const ringClass =
    flash === "green"
      ? "ring-4 ring-green-500/40"
      : flash === "red"
        ? "ring-4 ring-red-500/50"
        : "ring-1 ring-court-border";

  const heading =
    status === "already-solved"
      ? "Nice job!"
      : status === "streak-failed"
        ? "Streak ruined."
        : status === "solved"
          ? "Solved!"
          : status === "wrong"
            ? "Not quite — try again."
            : moveIdx === 0
              ? `${userColor === "white" ? "White" : "Black"} to move`
              : "Your move";

  const locked =
    status === "solved" ||
    status === "already-solved" ||
    status === "streak-failed";

  return (
    <div>
      {/* pr-7 reserves clearance on the right edge for the absolute-
          positioned X close button (right-2 + 14px icon + padding) so
          the rating chip doesn't tuck behind it. */}
      <div className="flex items-baseline justify-between gap-2 pr-7">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
          Chess Puzzle
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex items-baseline gap-1 rounded-full border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-medium text-court-fg-muted"
            title={`${streak} day${streak === 1 ? "" : "s"} solved in a row`}
          >
            <span aria-hidden>🔥</span>
            <span className="font-stat tabular-nums text-court-fg">
              {streak}
            </span>
            <span>day{streak === 1 ? "" : "s"}</span>
          </div>
          <div className="inline-flex items-baseline gap-1 rounded-full bg-court-accent-tint px-2 py-0.5 text-[11px] font-semibold text-court-accent-dark">
            <span className="font-stat tabular-nums">{puzzle.rating}</span>
            <span className="font-normal opacity-80">rating</span>
          </div>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-court-fg">{heading}</div>
        {history.length > 0 && !locked ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Step back one move"
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        ) : null}
      </div>

      <div
        className={`mt-3 overflow-hidden rounded-md transition ${ringClass}`}
      >
        <Chessboard
          position={fen}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          boardWidth={320}
          boardOrientation={userColor}
          arePiecesDraggable={!locked}
          customSquareStyles={customSquareStyles}
          customDarkSquareStyle={{ backgroundColor: "#5A9642" }}
          customLightSquareStyle={{ backgroundColor: "#EFF5EB" }}
        />
      </div>

      {status === "wrong" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={showHint}
            className="flex-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg transition hover:border-court-accent/40 hover:text-court-accent-dark"
          >
            Hint
          </button>
          <button
            type="button"
            onClick={showAnswer}
            className="flex-1 rounded-md bg-court-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-court-brand-dark"
          >
            Show Answer
          </button>
        </div>
      ) : null}

      {status === "solved" ? (
        <div className="mt-3 rounded-md bg-court-accent-tint px-3 py-2 text-xs font-semibold text-court-accent-dark">
          Solved! Puzzle rating {puzzle.rating}.
        </div>
      ) : null}

      {status === "already-solved" ? (
        <div className="mt-3 rounded-md bg-court-accent-tint px-3 py-2 text-xs font-semibold text-court-accent-dark">
          Nice job. You already solved this!
        </div>
      ) : null}

      {status === "streak-failed" ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          Streak ruined. Try again tomorrow!
        </div>
      ) : null}

      <a
        href={`https://lichess.org/training/${puzzle.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block text-center text-[11px] uppercase tracking-wider text-court-fg-muted hover:text-court-fg"
      >
        Open on Lichess
      </a>
    </div>
  );
}
