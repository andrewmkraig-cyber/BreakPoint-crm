import { prisma } from "@/lib/prisma";
import { getUnreadInboxSummary } from "@/lib/gmail";

// Shared snapshot of "what should the PWA app-icon badge read right now"
// for a given org. Three callers stuff this into the push payload so
// sw.js can call setAppBadge with a real total instead of the generic
// dot it fell back to before:
//   - src/app/api/webhooks/gmail/route.ts (new mail tag)
//   - src/app/api/quo/webhook/route.ts (sms + missed call)
//   - src/app/api/push/fire/route.ts (client-relayed pushes)
//
// Best-effort: any sub-query that throws degrades to null/0 rather
// than blocking the push. The client-side mail-tab-title-sync poll
// reconciles the real total once the user opens Ace.

export type UnreadCounts = {
  // null when no Gmail watch is reachable for the org — distinct from
  // 0 so the SW can choose to leave the badge alone instead of
  // clearing it.
  mailUnread: number | null;
  phoneUnread: number;
  // Always numeric: mailUnread + phoneUnread, treating an unreachable
  // mail count as 0. Earlier this went null whenever mailUnread was
  // null, and sw.js maps a null badgeCount to "leave the badge alone" -
  // which silently dropped every SMS/email badge update whenever the
  // webhook's live Gmail lookup hiccupped. The push must always carry a
  // real number so the app-icon badge fires even when Ace is closed;
  // the 15s client poll reconciles the mail portion the moment Ace
  // reopens if it was briefly unavailable here.
  badgeCount: number;
};

// Distinct unread *conversations*, not message rows — mirrors the
// grouping in /api/phone/unread-count/route.ts so the value adds
// cleanly to the mail thread count.
async function getPhoneUnreadForOrg(organizationId: string): Promise<number> {
  const rows = await prisma.smsMessage.findMany({
    where: { organizationId, direction: "inbound", isRead: false },
    select: { candidateId: true, clientId: true, fromNumber: true },
  });
  const keys = new Set<string>();
  for (const r of rows) keys.add(r.candidateId ?? r.clientId ?? r.fromNumber);
  return keys.size;
}

// Gmail unread is per-account, not per-org. Ace is single-tenant in
// practice so we sum across every active GmailPushWatch in the org —
// in the typical case that's just Andrew. Returns null if no watch
// resolves to a user we can mint a token for, so the SW can fall back
// to the generic dot rather than incorrectly clearing the badge.
async function getMailUnreadForOrg(
  organizationId: string,
): Promise<number | null> {
  const watches = await prisma.gmailPushWatch.findMany({
    where: { organizationId },
    select: { email: true },
  });
  if (watches.length === 0) return null;
  const users = await prisma.user.findMany({
    where: { email: { in: watches.map((w) => w.email) } },
    select: { id: true },
  });
  if (users.length === 0) return null;
  let total = 0;
  let anySucceeded = false;
  for (const u of users) {
    try {
      const summary = await getUnreadInboxSummary(u.id, { maxResults: 1 });
      total += summary.count;
      anySucceeded = true;
    } catch {
      // Skip this user — token refresh may have failed.
    }
  }
  return anySucceeded ? total : null;
}

export async function getUnreadCountsForOrg(
  organizationId: string,
): Promise<UnreadCounts> {
  const [phoneUnread, mailUnread] = await Promise.all([
    getPhoneUnreadForOrg(organizationId).catch(() => 0),
    getMailUnreadForOrg(organizationId).catch(() => null),
  ]);
  return {
    mailUnread,
    phoneUnread,
    // Always a real number so the SW can call setAppBadge on every push.
    // mailUnread is coalesced to 0 only when Gmail was genuinely
    // unreachable for this org at trigger time; that is rare and the
    // client poll corrects the total seconds after Ace reopens. The
    // mailUnread / phoneUnread fields above ride along untouched for
    // debugging which surface moved.
    badgeCount: (mailUnread ?? 0) + phoneUnread,
  };
}
