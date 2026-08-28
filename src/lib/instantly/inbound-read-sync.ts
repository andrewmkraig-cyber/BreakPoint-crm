import { prisma } from "@/lib/prisma";
import { fetchUnreadSnapshot, isInstantlyConfigured } from "@/lib/instantly/client";
import { InstantlyError } from "@/lib/instantly/errors";

// =====================================================================
// Inbound read sync: Instantly -> Ace.
//
// The mirror already ran one way (read it in Ace, mark-thread-read
// pushes that to Instantly). This is the return leg: clear the Ace badge
// and the Replies row for anything you already handled in Instantly's
// own Unibox, so the two inboxes agree no matter which one you cleared
// from.
//
// READ ONLY against Instantly - one GET /emails?is_unread=true listing.
// Every write lands in Neon.
//
// HOW "READ" IS DETECTED. Instantly's list projection carries is_unread
// but there is no "give me the read state of these 12 ids" endpoint, and
// asking per-row costs one call each against a 20/min budget. So this
// asks the cheap question instead - "what is STILL unread?" - and treats
// ABSENCE from that answer as read.
//
// Absence is only safe under conditions, and all of them are enforced
// below rather than assumed:
//
//   1. The listing must be COMPLETE. If pagination hit its page cap, the
//      tail was never seen and a missing row proves nothing. Truncated
//      run clears NOTHING and says so.
//   2. The row must be INSIDE the window. The window floor is the oldest
//      locally-unread reply minus a margin, so every candidate is
//      covered by the listing that judges it.
//   3. The row must predate the SNAPSHOT. A reply that landed while the
//      listing was in flight could not have been in it; clearing that
//      would silently eat a brand-new notification.
//   4. The row's THREAD must also be absent. Instantly's read state is
//      thread-level, so one unread sibling keeps the whole thread live.
//
// If Instantly ever stops honoring is_unread, the listing degrades to
// "every received email" - a superset - and this clears nothing instead
// of clearing everything. The failure direction is deliberate: a badge
// that lingers is a nuisance, a badge that vanishes loses a client
// reply.
//
// A row deleted or archived out of Instantly is also absent, so it
// clears too. That matches the intent - it is gone from the inbox you
// were clearing from.
// =====================================================================

// timestamp_created (what the listing filters on) is not always
// timestamp_email (what receivedAt prefers), and the two can straddle a
// boundary. A day of slack makes the window comfortably cover every
// candidate rather than betting on the two stamps agreeing.
const WINDOW_MARGIN_MS = 24 * 60 * 60 * 1000;

// Never look back further than this, however old the oldest unread row
// is. Beyond it the listing gets big enough to truncate, which clears
// nothing anyway.
const MAX_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

// 10 pages x 100 = 1000 unread threads. Past that the Unibox is not
// something a badge was ever going to represent, and the run bails
// rather than guessing at the tail.
const MAX_PAGES = 10;

// Sanity bound on how many local rows one pass considers. Only used to
// size the query - the clearing itself is a single updateMany.
const MAX_LOCAL_UNREAD = 1000;

export type InboundReadSyncResult = {
  /** True when a listing was fetched and the comparison actually ran. */
  ran: boolean;
  reason:
    | "ok"
    | "not_configured"
    | "nothing_unread"
    | "truncated"
    | "filter_not_honored"
    | "error";
  /** Local unread rows considered. */
  checked: number;
  /** Rows cleared because Instantly no longer has them unread. */
  cleared: number;
  /** Rows left unread because Instantly still has them unread. */
  stillUnread: number;
  pages?: number;
  error?: string;
};

export async function syncReadFromInstantly(
  organizationId: string,
): Promise<InboundReadSyncResult> {
  if (!isInstantlyConfigured()) {
    return { ran: false, reason: "not_configured", checked: 0, cleared: 0, stillUnread: 0 };
  }

  // Own outbound mail never reaches the badge or the list, so spending
  // budget to reconcile its read state would buy nothing.
  const unread = await prisma.instantlyReply.findMany({
    where: { organizationId, readAt: null, isOwnSender: false },
    orderBy: { receivedAt: "asc" },
    take: MAX_LOCAL_UNREAD,
    select: { id: true, instantlyEmailId: true, threadId: true, receivedAt: true },
  });

  // The common case by a mile: nothing unread locally, nothing to ask.
  // Costs zero Instantly calls, which is why this can run every tick.
  if (unread.length === 0) {
    return { ran: false, reason: "nothing_unread", checked: 0, cleared: 0, stillUnread: 0 };
  }

  const now = Date.now();
  const oldest = unread[0].receivedAt.getTime();
  const since = new Date(
    Math.max(oldest - WINDOW_MARGIN_MS, now - MAX_LOOKBACK_MS),
  );

  // Taken BEFORE the fetch. Anything newer than this could not have been
  // in the listing, so it is not eligible to be cleared by it.
  const snapshotAt = new Date();

  try {
    const snapshot = await fetchUnreadSnapshot({
      since: since.toISOString(),
      maxPages: MAX_PAGES,
    });

    // Guard 1: a truncated listing cannot prove absence.
    if (!snapshot.complete) {
      return {
        ran: false,
        reason: "truncated",
        checked: unread.length,
        cleared: 0,
        stillUnread: unread.length,
        pages: snapshot.pages,
      };
    }

    const eligible = unread.filter((r) => {
      // Guard 3: newer than the snapshot - not judged by this listing.
      if (r.receivedAt.getTime() > snapshotAt.getTime()) return false;
      // Guard 2: older than the window floor - not covered by it either.
      if (r.receivedAt.getTime() < since.getTime()) return false;
      return true;
    });

    const clearable = eligible.filter(
      (r) =>
        !snapshot.emailIds.has(r.instantlyEmailId) &&
        // Guard 4: thread-level read state.
        !(r.threadId && snapshot.threadIds.has(r.threadId)),
    );

    if (clearable.length > 0) {
      const readAt = new Date();
      await prisma.instantlyReply.updateMany({
        // organizationId stays in the filter (NN #8) even though the ids
        // came from a scoped read - the scope is not carried by an id.
        where: { organizationId, id: { in: clearable.map((r) => r.id) }, readAt: null },
        data: {
          readAt,
          // Instantly is where this was read, so the outbound mirror has
          // nothing left to do. Stamping it keeps the poller's read-sync
          // retry pass from spending calls re-telling Instantly something
          // it told us.
          instantlyReadSyncedAt: readAt,
        },
      });
    }

    return {
      ran: true,
      // Reported, not fatal: a dishonored filter turns the listing into a
      // superset, so this run simply clears less than it could have.
      reason: snapshot.filterHonored ? "ok" : "filter_not_honored",
      checked: unread.length,
      cleared: clearable.length,
      stillUnread: unread.length - clearable.length,
      pages: snapshot.pages,
    };
  } catch (e) {
    return {
      ran: false,
      reason: "error",
      checked: unread.length,
      cleared: 0,
      stillUnread: unread.length,
      error:
        e instanceof InstantlyError
          ? `${e.kind}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Inbound read sync failed.",
    };
  }
}
