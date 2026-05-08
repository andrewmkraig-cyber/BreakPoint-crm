"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
        setPuzzle({
          id,
          rating: json.puzzle?.rating ?? 0,
          fen,
          solution,
          themes: json.puzzle?.themes ?? [],
        });
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
        className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-fg"
      >
        <span aria-hidden="true">♟</span>
        <span>Chess Puzzle</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chess puzzle"
          className="absolute bottom-full left-0 z-20 mb-2 w-[360px] rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
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
    window.setTimeout(() => {
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

  function showHint() {
    setHintActive(true);
    setStatus("playing");
  }

  // Show Answer plays the remaining solution out for the user, with
  // a small delay between each move so the sequence is readable.
  function showAnswer() {
    setHintActive(false);
    let idx = moveIdx;
    const step = () => {
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
      window.setTimeout(step, 550);
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
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
          Chess Puzzle
        </div>
        <div className="inline-flex items-baseline gap-1 rounded-full bg-court-accent-tint px-2 py-0.5 text-[11px] font-semibold text-court-accent-dark">
          <span className="font-stat tabular-nums">{puzzle.rating}</span>
          <span className="font-normal opacity-80">rating</span>
        </div>
      </div>
      <div className="mt-1 text-sm font-semibold text-court-fg">{heading}</div>

      <div
        className={`mt-3 overflow-hidden rounded-md transition ${ringClass}`}
      >
        <Chessboard
          position={fen}
          onPieceDrop={onPieceDrop}
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
