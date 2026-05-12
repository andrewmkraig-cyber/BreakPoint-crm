import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Per-user thumbs feedback on a fun fact. POSTed from the briefing
// chip's thumbs up/down buttons; the next day's generator reads
// recent votes to bias topic selection toward what this user likes.
// Idempotent — re-voting overwrites the prior vote so a user can
// flip-flop without producing duplicate rows.

export const dynamic = "force-dynamic";

type Body = { factId?: unknown; vote?: unknown };

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unknown user" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const factId = typeof body.factId === "string" ? body.factId : null;
  const voteRaw = body.vote;
  const vote = voteRaw === 1 || voteRaw === -1 ? voteRaw : null;
  if (!factId || vote === null) {
    return NextResponse.json(
      { ok: false, error: "Expected { factId: string, vote: 1 | -1 }" },
      { status: 400 },
    );
  }

  // Enforce org boundary: the fact must belong to the caller's org.
  const org = await getCurrentOrg();
  const fact = await prisma.funFact.findFirst({
    where: { id: factId, organizationId: org.id },
    select: { id: true },
  });
  if (!fact) {
    return NextResponse.json({ ok: false, error: "Fact not found" }, { status: 404 });
  }

  await prisma.funFactFeedback.upsert({
    where: { factId_userId: { factId, userId: user.id } },
    update: { vote },
    create: { factId, userId: user.id, vote },
  });

  return NextResponse.json({ ok: true, vote });
}

// Clear the user's vote (toggle-off behavior — clicking the active
// thumb a second time removes the vote rather than leaving it stuck).
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unknown user" }, { status: 401 });
  }

  const url = new URL(req.url);
  const factId = url.searchParams.get("factId");
  if (!factId) {
    return NextResponse.json({ ok: false, error: "Missing factId" }, { status: 400 });
  }

  await prisma.funFactFeedback.deleteMany({
    where: { factId, userId: user.id },
  });
  return NextResponse.json({ ok: true });
}
