"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

// Interactive Lichess puzzle in the 800-1200 rating band. Pulls a
// random easy puzzle from /api/puzzle/next?difficulty=easiest, renders
// the position with react-chessboard, and validates each user move
// against the published solution. The daily endpoint trends 1800-2200
// rating which is too sharp for a quick dashboard distraction; the
// `easiest` difficulty band on the `next` endpoint tops out around
// 1200, which is the level Andrew asked for. The endpoint ships
// initialPly without an explicit fen, so deriveFen() replays the PGN.
//
// Convention: solution[0] is the user's first move (FEN side-to-move
// == user's color); odd-indexed moves are auto-played by the opponent.

type LichessPuzzleResponse = {
  puzzle?: {
    id?: string;
    rating?: number;
    plays?: number;
    initialPly?: number;
    solution?: string[];
    themes?: string[];
    fen?: string;
  };
  game?: {
    pgn?: string;
  };
};

type Puzzle = {
  id: string;
  rating: number;
  fen: string;
  solution: string[];
  themes: string[];
};

type Status = "playing" | "wrong" | "solved";

type UciMove = { from: Square; to: Square; promotion?: string };

// Streak state persists across reloads so the day count survives a
// hard refresh. failedDate stops a same-day re-solve from un-doing a
// wrong move's reset — once you blow it for the day, you're at 0
// until tomorrow.
const STREAK_KEY = "ace.chess.streak";
const LAST_SOLVED_KEY = "ace.chess.lastSolvedDate";
const FAILED_DATE_KEY = "ace.chess.failedDate";

// Daily puzzle cache. Without this, /api/puzzle/next returns a fresh
// random puzzle on every page load and the "one puzzle per day"
// model breaks — Andrew would solve at breakfast, refresh later, and
// see a different puzzle the same day. localStorage cache stamps the
// puzzle with today's ET date and reuses it until midnight ET.
const PUZZLE_CACHE_KEY = "ace.chess.puzzle";
const PUZZLE_DATE_KEY = "ace.chess.puzzleDate";

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

function readStreak(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(STREAK_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function loadCachedPuzzle(): Puzzle | null {
  if (typeof window === "undefined") return null;
  try {
    const stamp = window.localStorage.getItem(PUZZLE_DATE_KEY);
    if (stamp !== todayET()) return null;
    const raw = window.localStorage.getItem(PUZZLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Puzzle>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.rating === "number" &&
      typeof parsed.fen === "string" &&
      Array.isArray(parsed.solution) &&
      Array.isArray(parsed.themes)
    ) {
      return parsed as Puzzle;
    }
  } catch {
    // fall through — corrupted cache, just refetch
  }
  return null;
}

function saveCachedPuzzle(puzzle: Puzzle): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUZZLE_CACHE_KEY, JSON.stringify(puzzle));
    window.localStorage.setItem(PUZZLE_DATE_KEY, todayET());
  } catch {
    // localStorage full / disabled — non-fatal, just won't cache
  }
}

function parseUci(uci: string): UciMove {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

// Lichess daily endpoint sometimes ships only a PGN — derive the FEN
// by replaying the game up to initialPly when puzzle.fen is missing.
function deriveFen(payload: LichessPuzzleResponse): string | null {
  const fen = payload.puzzle?.fen;
  if (fen) return fen;
  const pgn = payload.game?.pgn;
  const ply = payload.puzzle?.initialPly;
  if (!pgn || ply == null) return null;
  try {
    const g = new Chess();
    g.loadPgn(pgn);
    const history = g.history({ verbose: true });
    g.reset();
    for (let i = 0; i <= ply && i < history.length; i++) {
      const h = history[i];
      g.move({ from: h.from, to: h.to, promotion: h.promotion });
    }
    return g.fen();
  } catch {
    return null;
  }
}

export function ChessPuzzle() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Day-stable cache wins over hitting Lichess again — the streak
    // model assumes the puzzle is fixed across the ET day.
    const cached = loadCachedPuzzle();
    if (cached) {
      setPuzzle(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "https://lichess.org/api/puzzle/next?difficulty=easiest",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as LichessPuzzleResponse;
        if (cancelled) return;
        const id = json.puzzle?.id;
        const solution = json.puzzle?.solution ?? [];
        const fen = deriveFen(json);
        if (!id || solution.length === 0 || !fen) return;
        const next: Puzzle = {
          id,
          rating: json.puzzle?.rating ?? 0,
          fen,
          solution,
          themes: json.puzzle?.themes ?? [],
        };
        saveCachedPuzzle(next);
        setPuzzle(next);
      } catch {
        // Silent — pill stays hidden if Lichess is unreachable.
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        {/* Inline chess-king silhouette — the previous unicode pawn
            glyph (♟) wasn't rendering as a chess piece on Andrew's
            stack (it fell through to a generic triangle), so we ship
            our own path. currentColor lets the chip's text color
            tint the icon. */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="currentColor"
        >
          <path d="M11 2v2H9v2h2v2H8.5A2.5 2.5 0 0 0 6 10.5v.4c0 1.4.6 2.7 1.7 3.6l1.3 1.1V18H7v3h10v-3h-2v-2.4l1.3-1.1A4.6 4.6 0 0 0 18 10.9v-.4A2.5 2.5 0 0 0 15.5 8H13V6h2V4h-2V2h-2zM9 19h6v1H9v-1z" />
        </svg>
        <span>Daily Chess Puzzle</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chess puzzle"
          className="absolute bottom-full right-0 z-20 mb-2 w-[360px] rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-2 top-2 z-10 rounded-md p-0.5 text-court-fg-muted opacity-40 transition hover:bg-court-surface-subtle hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <PuzzleBoard puzzle={puzzle} />
        </div>
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

  // Hydrate streak after mount — reading localStorage during initial
  // state would trip Next's SSR mismatch warning.
  useEffect(() => {
    setStreak(readStreak());
  }, []);

  // Effect-driven streak updates: status is the only signal, so the
  // useEffect runs once per transition into "wrong" or "solved".
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status === "wrong") {
      window.localStorage.setItem(STREAK_KEY, "0");
      window.localStorage.setItem(FAILED_DATE_KEY, todayET());
      setStreak(0);
      return;
    }
    if (status === "solved") {
      const today = todayET();
      const failedToday =
        window.localStorage.getItem(FAILED_DATE_KEY) === today;
      if (failedToday) return; // wrong move earlier today — no credit
      const lastSolved = window.localStorage.getItem(LAST_SOLVED_KEY);
      if (lastSolved === today) return; // already credited today
      const next =
        lastSolved === yesterdayET() ? readStreak() + 1 : 1;
      window.localStorage.setItem(STREAK_KEY, String(next));
      window.localStorage.setItem(LAST_SOLVED_KEY, today);
      setStreak(next);
    }
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
    if (status === "solved") return false;
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
      boxShadow: "inset 0 0 0 4px rgba(59, 130, 246, 0.7)",
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
          "radial-gradient(circle, rgba(59,130,246,0.35) 22%, transparent 23%)",
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
    status === "solved"
      ? "Solved!"
      : status === "wrong"
        ? "Not quite — try again."
        : moveIdx === 0
          ? `${userColor === "white" ? "White" : "Black"} to move`
          : "Your move";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
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
        {history.length > 0 && status !== "solved" ? (
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
          arePiecesDraggable={status !== "solved"}
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
