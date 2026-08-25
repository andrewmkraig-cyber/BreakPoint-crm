import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { notifiableWhere, MAX_ENRICH_ATTEMPTS } from "@/lib/instantly/poller";
import { getInstantlyPrefs } from "@/lib/instantly/prefs";

export const dynamic = "force-dynamic";

// Unread genuine replies, for the sidebar badge and the toast poller.
//
// Reads ONLY from Neon - no Instantly call, so this can poll every 15s
// alongside the mail/phone providers without touching the 20/min
// /emails budget at all.
//
// Confirmed auto-replies are excluded by notifiableWhere() at the query
// level, so they can never reach the badge or fire a toast. Unresolved
// replies are included only once they have exhausted their enrichment
// attempts, and are flagged `unverified` so the UI can say the
// auto-reply check never completed.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: 0, latest: [], enabled: false }, { status: 200 });
  }

  try {
    const [org, prefs] = await Promise.all([getCurrentOrg(), getInstantlyPrefs()]);

    const where = { ...notifiableWhere(org.id), readAt: null };

    const [count, latest] = await Promise.all([
      prisma.instantlyReply.count({ where }),
      prisma.instantlyReply.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        take: 10,
        select: {
          id: true,
          instantlyEmailId: true,
          threadId: true,
          campaignName: true,
          fromEmail: true,
          leadEmail: true,
          subject: true,
          snippet: true,
          receivedAt: true,
          isAutoReply: true,
          enrichAttempts: true,
          isFocused: true,
        },
      }),
    ]);

    return NextResponse.json(
      {
        count,
        enabled: prefs.replyNotificationsEnabled,
        latest: latest.map((r) => ({
          id: r.id,
          // Instantly's own email id. The Replies list is keyed by it,
          // so the deep link must use this, not our cuid.
          emailId: r.instantlyEmailId,
          threadId: r.threadId,
          campaignName: r.campaignName,
          fromEmail: r.fromEmail ?? r.leadEmail,
          subject: r.subject,
          snippet: r.snippet,
          receivedAtIso: r.receivedAt.toISOString(),
          // True when we notified without ever resolving the auto-reply
          // check. The toast and row both say so.
          unverified: r.isAutoReply === null && r.enrichAttempts >= MAX_ENRICH_ATTEMPTS,
        })),
      },
      { status: 200 },
    );
  } catch {
    // Unknown rather than zero: a failed read must not blank the badge.
    return NextResponse.json({ count: null, latest: [], enabled: true }, { status: 200 });
  }
}
