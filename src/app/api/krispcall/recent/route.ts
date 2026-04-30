import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Recent-inbound feed for the in-app text/call notification toaster.
// Returns inbound SmsMessage + inbound CallLog rows from the last
// 5 minutes so the client can diff against its seen-id set and fire
// a toast for anything new. Cap at 10 of each so a noisy minute
// doesn't blow up the response.
//
// Auth: session-gated like /api/mail/unread; unauthenticated callers
// get an empty payload (200) so the badge / poller never throws.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ texts: [], calls: [] });
  }
  const sinceMs = Date.now() - 5 * 60 * 1000;
  const since = new Date(sinceMs);

  const [texts, calls] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { direction: "inbound", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        body: true,
        fromNumber: true,
        candidateId: true,
        createdAt: true,
      },
    }),
    prisma.callLog.findMany({
      where: { direction: "inbound", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        fromNumber: true,
        duration: true,
        status: true,
        candidateId: true,
        createdAt: true,
      },
    }),
  ]);

  // Hydrate candidate names in one round-trip so the toast renders
  // a real name instead of just a phone number. candidateId is nullable
  // now (unknown-number rows leave it null), so filter those out before
  // the lookup — the toast just falls back to the phone number for
  // those.
  const candidateIds = Array.from(
    new Set(
      [...texts, ...calls]
        .map((r) => r.candidateId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const candidates = candidateIds.length
    ? await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(
    candidates.map((c) => [c.id, `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()]),
  );

  return NextResponse.json({
    texts: texts.map((t) => ({
      id: t.id,
      candidateId: t.candidateId,
      candidateName: t.candidateId ? nameById.get(t.candidateId) || "" : "",
      fromNumber: t.fromNumber,
      body: t.body,
      createdAtIso: t.createdAt.toISOString(),
    })),
    calls: calls.map((c) => ({
      id: c.id,
      candidateId: c.candidateId,
      candidateName: c.candidateId ? nameById.get(c.candidateId) || "" : "",
      fromNumber: c.fromNumber,
      duration: c.duration,
      status: c.status,
      createdAtIso: c.createdAt.toISOString(),
    })),
  });
}
