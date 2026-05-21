import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

// Daily auto-release for per-user client ownership (Step 5). A client
// that has had no activity for 60+ days has its owner cleared so it
// becomes Available for anyone to claim again.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` - same gate
// as the news-feed cron. Cron invocations carry no session, so this is
// the only thing standing between the endpoint and the public internet.
//
// "Activity" here is an ActivityLog row written against the client.
// Client activity is logged under either the Client cuid (Ace-native)
// or the stringified legacyRfId (back-compat), so both forms are
// considered when finding the most-recent entry.
//
// Grace floor: a client is only eligible once it is at least
// RELEASE_AFTER_DAYS old (by Client.createdAt). Without this, a freshly
// imported or newly created client with no logged activity would be
// released on the very first run. In effect the inactivity clock only
// starts once the client has existed for the full window.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RELEASE_AFTER_DAYS = 60;
const RELEASE_MESSAGE = "Client released to available - no activity in 60 days.";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  // Vercel sends `Bearer <secret>`; accept that exact form.
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Cron runs without a session, so we resolve org via the env fallback
  // (same DEFAULT_ORG_ID the news-feed cron uses). When the CRM grows
  // past the single BreakPoint Talent org we'll iterate over all orgs.
  const organizationId = process.env.DEFAULT_ORG_ID;
  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: "DEFAULT_ORG_ID env var not set - cron has no org to scope to" },
      { status: 500 },
    );
  }

  const cutoff = new Date(Date.now() - RELEASE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  // Every owned client in the tenant (Rule 8: org-scoped) that is also
  // past the grace floor: createdAt older than the cutoff means the
  // client has existed for at least RELEASE_AFTER_DAYS, so clients
  // younger than the window are excluded here and never auto-released.
  const owned = await prisma.client.findMany({
    where: {
      organizationId,
      ownerId: { not: null },
      createdAt: { lt: cutoff },
    },
    select: { id: true, legacyRfId: true, name: true, ownerId: true, createdAt: true },
  });

  if (owned.length === 0) {
    return NextResponse.json({
      ok: true,
      organizationId,
      scanned: 0,
      released: 0,
      releasedClients: [],
    });
  }

  // Most-recent client ActivityLog timestamp, grouped across both the
  // cuid and the stringified legacyRfId targetId forms.
  const targetIds = [
    ...owned.map((c) => c.id),
    ...owned.filter((c) => c.legacyRfId != null).map((c) => String(c.legacyRfId)),
  ];
  const groups = await prisma.activityLog.groupBy({
    by: ["targetId"],
    where: { organizationId, targetType: "client", targetId: { in: targetIds } },
    _max: { timestamp: true },
  });
  const lastByTargetId = new Map<string, Date>();
  for (const g of groups) {
    if (g._max.timestamp) lastByTargetId.set(g.targetId, g._max.timestamp);
  }

  const lastFor = (c: { id: string; legacyRfId: number | null }): Date | null => {
    const a = lastByTargetId.get(c.id);
    const b = c.legacyRfId != null ? lastByTargetId.get(String(c.legacyRfId)) : undefined;
    if (a && b) return a.getTime() >= b.getTime() ? a : b;
    return a ?? b ?? null;
  };

  // Release when there is no activity at all, or the latest entry is
  // older than the cutoff.
  const toRelease = owned.filter((c) => {
    const last = lastFor(c);
    return last == null || last.getTime() < cutoff.getTime();
  });

  const releasedClients: { id: string; name: string }[] = [];
  for (const c of toRelease) {
    try {
      // Org-scoped update (Rule 8): updateMany lets us add organizationId
      // to the WHERE so a stray cross-org id can never be cleared.
      const res = await prisma.client.updateMany({
        where: { id: c.id, organizationId, ownerId: { not: null } },
        data: { ownerId: null },
      });
      if (res.count === 0) continue; // already released / not in org

      const last = lastFor(c);
      await logActivity({
        organizationId,
        // Attribute the release to the former owner so it lands in their
        // activity history; the User row is guaranteed to exist.
        userId: c.ownerId!,
        actionType: "client_released",
        targetType: "client",
        targetId: c.id, // cuid so the client detail Activity feed picks it up
        metadata: {
          message: RELEASE_MESSAGE,
          releasedFromUserId: c.ownerId,
          lastActivityAt: last ? last.toISOString() : null,
        },
      });
      releasedClients.push({ id: c.id, name: c.name });
    } catch (e) {
      // Per-client try/catch so one failure doesn't abort the batch.
      // eslint-disable-next-line no-console
      console.error("[client-release] failed", {
        clientId: c.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    organizationId,
    scanned: owned.length,
    released: releasedClients.length,
    releasedClients,
  });
}
