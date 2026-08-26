import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { MAX_ENRICH_ATTEMPTS } from "@/lib/instantly/poller";

export const dynamic = "force-dynamic";

// GET /api/instantly/replies?campaignId=&page=&includeAuto=
//
// Reads from NEON, not from Instantly.
//
// WHY THIS CHANGED. It used to fetch a page of 12 live from Instantly,
// enrich them, and then drop the confirmed auto-replies - which meant a
// page containing 8 out-of-office messages rendered 4 rows and the next
// rendered 11. Filtering after paging cannot produce full pages.
//
// The poller already mirrors every reply into Neon with isAutoReply
// resolved, so the filter belongs in the WHERE clause, before LIMIT /
// OFFSET. Every page now comes back full by construction.
//
// This does NOT relax the rate-limit guard. It removes this path from
// the /emails budget entirely: the enrichment calls still happen, still
// capped at 10 per run and still yielding to interactive use, but they
// happen in the poller where they belong. A list read costs zero
// Instantly requests.

const PAGE_SIZE = 12;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, kind: "unauthorized", message: "Not signed in.", hint: "Sign in to Ace." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId") ?? undefined;
  const includeAuto = searchParams.get("includeAuto") === "true";
  const page = Math.max(0, Number(searchParams.get("page") ?? 0) || 0);

  try {
    const org = await getCurrentOrg();

    const where = {
      organizationId: org.id,
      // Our own outbound mail is never a lead reply. Excluded at the
      // query level so it can't reach the list, the pager, or the count.
      isOwnSender: false,
      ...(campaignId ? { campaignId } : {}),
      // Confirmed auto-replies drop out here, BEFORE paging. Unresolved
      // rows (isAutoReply null) stay - they render as Unverified rather
      // than being silently hidden or silently promoted.
      ...(includeAuto ? {} : { isAutoReply: { not: true } }),
    };

    const [total, rows] = await Promise.all([
      prisma.instantlyReply.count({ where }),
      prisma.instantlyReply.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        replies: rows.map((r) => ({
          id: r.instantlyEmailId,
          rowId: r.id,
          threadId: r.threadId,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          leadEmail: r.leadEmail,
          fromEmail: r.fromEmail,
          subject: r.subject,
          snippet: r.snippet,
          bodyText: r.bodyText,
          bodyHtml: "",
          receivedAt: r.receivedAt.toISOString(),
          isAutoReply: r.isAutoReply,
          countsAsReply: r.isAutoReply === false,
          isUnread: r.readAt === null,
          eaccount: r.eaccount,
          threadUrl: r.threadId
            ? `https://app.instantly.ai/app/unibox/${encodeURIComponent(r.threadId)}?mode=${r.isFocused ? "emode_focused" : "emode_others"}`
            : null,
          unverified:
            r.isAutoReply === null && r.enrichAttempts >= MAX_ENRICH_ATTEMPTS,
        })),
        page,
        pageSize: PAGE_SIZE,
        total,
        hasMore: (page + 1) * PAGE_SIZE < total,
        // Still reported so the UI can show how much of the page has not
        // yet been classified. No longer a rate-limit signal - nothing on
        // this path calls Instantly.
        pendingCount: rows.filter((r) => r.isAutoReply === null).length,
        budgetExhausted: false,
        retryAfterMs: 0,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        kind: "unavailable",
        message: e instanceof Error ? e.message : "Could not load replies.",
        hint: "Check the connection and try again.",
      },
      { status: 200 },
    );
  }
}
