import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Per-user chess-puzzle streak. Replaces the localStorage-only store
// that was per-browser — iPad vs laptop now read the same row so the
// streak follows the recruiter across devices.
//
// GET returns the current values (streak / lastSolvedDate / failedDate).
// POST upserts the user's row. The client posts on solve/fail and also
// runs a one-shot migration of any pre-existing localStorage values into
// the row when GET comes back empty.

export const dynamic = "force-dynamic";

type StreakResponse = {
  ok: true;
  streak: number;
  lastSolvedDate: string | null;
  failedDate: string | null;
};

type ErrorResponse = { ok: false; error: string };

async function resolveUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function GET(): Promise<NextResponse<StreakResponse | ErrorResponse>> {
  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const row = await prisma.chessPuzzleStreak.findUnique({
    where: { userId },
  });
  return NextResponse.json({
    ok: true,
    streak: row?.streak ?? 0,
    lastSolvedDate: row?.lastSolvedDate ?? null,
    failedDate: row?.failedDate ?? null,
  });
}

type StreakPostBody = {
  streak?: number;
  // null clears the field; undefined leaves the prior value in place.
  lastSolvedDate?: string | null;
  failedDate?: string | null;
};

export async function POST(
  req: Request,
): Promise<NextResponse<StreakResponse | ErrorResponse>> {
  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  let body: StreakPostBody;
  try {
    body = (await req.json()) as StreakPostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const streak =
    typeof body.streak === "number" && Number.isFinite(body.streak) && body.streak >= 0
      ? Math.floor(body.streak)
      : 0;

  const update: {
    streak: number;
    lastSolvedDate?: string | null;
    failedDate?: string | null;
  } = { streak };
  if (body.lastSolvedDate !== undefined) update.lastSolvedDate = body.lastSolvedDate;
  if (body.failedDate !== undefined) update.failedDate = body.failedDate;

  const org = await getCurrentOrg();
  const row = await prisma.chessPuzzleStreak.upsert({
    where: { userId },
    update,
    create: {
      userId,
      organizationId: org.id,
      streak,
      lastSolvedDate: body.lastSolvedDate ?? null,
      failedDate: body.failedDate ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    streak: row.streak,
    lastSolvedDate: row.lastSolvedDate,
    failedDate: row.failedDate,
  });
}
