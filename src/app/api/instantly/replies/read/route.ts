import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { markInstantlyThreadRead } from "@/lib/instantly/mark-thread-read";

export const dynamic = "force-dynamic";

// Mark replies read. This writes `readAt` in NEON ONLY.
//
// readAt in Neon is AUTHORITATIVE and is written first. Ace then makes a
// best-effort attempt to mirror it into Instantly's Unibox via the one
// allowlisted write (POST /emails/threads/{id}/mark-as-read).
//
// If that outbound call fails, the local read state is NOT reverted. A
// badge that lies about what you have already looked at is worse than a
// thread staying bold in Instantly, and the poller retries unsynced rows
// on its next pass (capped). The response reports what synced, but the
// UI intentionally surfaces nothing for an unsynced row - there is no
// action for the user to take.

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { ids?: string[]; emailIds?: string[]; all?: boolean }
    | null;
  if (!body) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  try {
    const org = await getCurrentOrg();
    const now = new Date();

    // Tenant scoping (NN #8): organizationId is always in the filter, so
    // an id from another org can never be marked read.
    const selector = {
      organizationId: org.id,
      readAt: null,
      // Accept either our cuid or Instantly's email id - the toast
      // knows the former, the Replies list knows the latter.
      ...(body.all
        ? {}
        : {
            OR: [
              { id: { in: body.ids ?? [] } },
              { instantlyEmailId: { in: body.emailIds ?? [] } },
            ],
          }),
    };

    // Capture the threads BEFORE the update, while readAt is still null.
    const affected = await prisma.instantlyReply.findMany({
      where: selector,
      select: { id: true, threadId: true },
    });

    const result = await prisma.instantlyReply.updateMany({
      where: selector,
      data: { readAt: now },
    });

    // Best-effort outward mirror, one call per DISTINCT thread (several
    // replies commonly share one). A failure only bumps the attempt
    // counter - readAt above stands regardless, and the poller retries.
    const threads = Array.from(
      new Set(affected.map((a) => a.threadId).filter((t): t is string => Boolean(t))),
    );
    let threadsSynced = 0;
    for (const threadId of threads) {
      const res = await markInstantlyThreadRead(threadId);
      const rowIds = affected.filter((a) => a.threadId === threadId).map((a) => a.id);
      if (res.ok) {
        threadsSynced++;
        await prisma.instantlyReply.updateMany({
          where: { id: { in: rowIds } },
          data: {
            instantlyReadSyncedAt: new Date(),
            instantlyReadSyncAttempts: { increment: 1 },
          },
        });
      } else {
        await prisma.instantlyReply.updateMany({
          where: { id: { in: rowIds } },
          data: { instantlyReadSyncAttempts: { increment: 1 } },
        });
        // Out of budget - leave the remainder to the poller's retry pass.
        if (res.kind === "rate_limited") break;
      }
    }

    return NextResponse.json(
      { ok: true, updated: result.count, threadsSynced, threadsTotal: threads.length },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to mark read." },
      { status: 200 },
    );
  }
}
