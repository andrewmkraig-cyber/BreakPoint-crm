import type { NextRequest } from "next/server";
import {
  listReplies,
  enrichAutoReplyFlags,
  emailsBudgetRemaining,
} from "@/lib/instantly/client";
import { instantlyThreadUrl } from "@/lib/instantly/types";
import { withInstantly } from "@/app/api/instantly/_respond";

export const dynamic = "force-dynamic";

// GET /api/instantly/replies?campaignId=&page=&includeAuto=
//
// Inbound replies for the Replies view. READ ONLY - Ace never replies,
// forwards, or marks anything. The "Open in Instantly" link is how a
// response actually gets sent.
//
// RATE BUDGET. Auto-reply classification costs one /emails/{id} call per
// row (the list endpoint does not carry is_auto_reply), against a
// 20/min ceiling. So:
//   - the page size is 12, inside the 10-15 target with headroom
//   - enrichment is NON-BLOCKING: it takes the budget available right
//     now and leaves the rest pending rather than stalling the response
//   - the payload reports pendingCount + retryAfterMs so the client can
//     quietly fill in stragglers instead of showing a spinner
// A page NEVER waits on the rate limiter.

const PAGE_SIZE = 12;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId") ?? undefined;
  const includeAuto = searchParams.get("includeAuto") === "true";
  const page = Math.max(0, Number(searchParams.get("page") ?? 0) || 0);

  return withInstantly(async () => {
    // Fetch enough pages to cover the requested offset. listReplies is
    // cursor-paginated, so page N needs the first N+1 pages walked. The
    // maxPages cap keeps a deep jump from running away.
    const needed = (page + 1) * PAGE_SIZE;
    const all = await listReplies({
      campaignId,
      limit: 100,
      fetchAll: needed > 100,
      maxPages: Math.min(5, Math.ceil(needed / 100) || 1),
    });

    const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    // Only the rows actually being rendered get enriched.
    const result = await enrichAutoReplyFlags(slice, {
      max: PAGE_SIZE,
      includeAutoReplies: includeAuto,
      waitForBudget: false,
    });

    return {
      replies: result.replies.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        campaignId: r.campaignId,
        leadEmail: r.leadEmail,
        fromEmail: r.fromEmail,
        subject: r.subject,
        snippet: r.snippet,
        bodyText: r.bodyText,
        bodyHtml: r.bodyHtml,
        receivedAt: r.receivedAt,
        isAutoReply: r.isAutoReply,
        countsAsReply: r.countsAsReply,
        isUnread: r.isUnread,
        eaccount: r.eaccount,
        threadUrl: instantlyThreadUrl(r),
      })),
      page,
      pageSize: PAGE_SIZE,
      // `all` is capped by maxPages, so this is "at least this many".
      totalFetched: all.length,
      hasMore: all.length > (page + 1) * PAGE_SIZE,
      enrichedCount: result.enrichedCount,
      pendingCount: result.pendingCount,
      budgetExhausted: result.budgetExhausted,
      retryAfterMs: result.retryAfterMs,
      budgetRemaining: emailsBudgetRemaining(),
    };
  });
}
