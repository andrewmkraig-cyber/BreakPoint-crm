import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Daily Lichess puzzle for the dashboard, shared across the org. The
// route hits Lichess at most once per (org, ET day) — first request
// fetches /api/puzzle/next?difficulty=easiest, derives the FEN if the
// payload only ships a PGN, and persists the result. Every later load
// for any user in the same org returns the cached row.
//
// solution and themes are stored as JSON; rating + lichessId let the
// client deep-link to lichess.org/training/{id} and show the rating
// chip without an extra fetch.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

type PuzzlePayload = {
  id: string;
  rating: number;
  fen: string;
  solution: string[];
  themes: string[];
};

function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

// Lichess sometimes omits puzzle.fen and ships only the game's PGN +
// the ply at which the puzzle starts; replay the PGN up to initialPly
// to derive the position. Mirrors the deriveFen logic that used to
// live in the client component.
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

function rowToPayload(row: {
  lichessId: string;
  rating: number;
  fen: string;
  solution: unknown;
  themes: unknown;
}): PuzzlePayload {
  return {
    id: row.lichessId,
    rating: row.rating,
    fen: row.fen,
    solution: Array.isArray(row.solution) ? (row.solution as string[]) : [],
    themes: Array.isArray(row.themes) ? (row.themes as string[]) : [],
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  const generatedDate = todayInEastern();

  const cached = await prisma.chessPuzzleOfDay.findUnique({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
  });
  if (cached) {
    return NextResponse.json({
      ok: true,
      cached: true,
      puzzle: rowToPayload(cached),
    });
  }

  let payload: PuzzlePayload | null = null;
  try {
    const res = await fetch(
      "https://lichess.org/api/puzzle/next?difficulty=easiest",
      { cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Lichess HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as LichessPuzzleResponse;
    const id = json.puzzle?.id;
    const solution = json.puzzle?.solution ?? [];
    const fen = deriveFen(json);
    if (id && solution.length > 0 && fen) {
      payload = {
        id,
        rating: json.puzzle?.rating ?? 0,
        fen,
        solution,
        themes: json.puzzle?.themes ?? [],
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lichess fetch failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Lichess returned no usable puzzle" },
      { status: 502 },
    );
  }

  // Upsert in case a concurrent request beat us — the unique
  // (org, generatedDate) constraint would otherwise throw.
  const row = await prisma.chessPuzzleOfDay.upsert({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      lichessId: payload.id,
      rating: payload.rating,
      fen: payload.fen,
      solution: payload.solution,
      themes: payload.themes,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    puzzle: rowToPayload(row),
  });
}
