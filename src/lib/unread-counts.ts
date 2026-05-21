import { prisma } from "@/lib/prisma";
import { getUnreadInboxThreadIdsStrict } from "@/lib/gmail";
import { computeBadgeCount } from "@/lib/badge-math";

// Shared snapshot of "what should the PWA app-icon badge read right now"
// for a given org. Three callers stuff this into the push payload so
// sw.js can call setAppBadge with a real total instead of the generic
// dot it fell back to before:
//   - src/app/api/webhooks/gmail/route.ts (new mail tag)
//   - src/app/api/quo/webhook/route.ts (sms + missed call)
//   - src/app/api/push/fire/route.ts (client-relayed pushes)
//
// Reliability is the whole point: a count we cannot PROVE (Gmail
// unreachable, no resolvable user, local SMS query failing) surfaces as
// null - never 0 - so the push omits badgeCount and sw.js leaves the
// existing app badge untouched. Coercing an unavailable Gmail count to 0
// was what let a new SMS knock the badge from 4 down to 1.

export type UnreadCounts = {
  // null when the Gmail unread count could not be proven for the org (no
  // reachable watch/user, or the Gmail API call failed) - distinct from 0
  // so the badge is omitted instead of cleared.
  mailUnread: number | null;
  // null when the local SMS unread query failed - same reasoning.
  phoneUnread: number | null;
  // mailUnread + phoneUnread, but ONLY when both are reliable; null
  // otherwise. A null badgeCount is omitted from the push payload, which
  // sw.js maps to "leave the app badge alone".
  badgeCount: number | null;
  // Diagnostics only: was the Gmail unread count proven this call.
  mailReliable: boolean;
};

// Distinct unread *conversations*, not message rows - mirrors the
// grouping in /api/phone/unread-count/route.ts so the value adds cleanly
// to the mail thread count.
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
// practice so we union the unread INBOX thread IDs across every active
// GmailPushWatch in the org - in the typical case that's just Andrew.
// `extraUnreadThreadIds` lets the Gmail push webhook fold in a thread it
// just saw arrive: Gmail's is:unread search index lags a few seconds
// behind a brand-new message, so without this the badge undercounts the
// very email the push fired for.
//
// Returns null - meaning "mail unread is unprovable, omit the badge" -
// when there is no resolvable Gmail user OR any user's Gmail lookup
// fails. It must NEVER return 0 for a failed lookup; 0 is reserved for a
// successful lookup that found an empty inbox.
async function getMailUnreadForOrg(
  organizationId: string,
  extraUnreadThreadIds: string[] = [],
): Promise<number | null> {
  const unread = new Set<string>(extraUnreadThreadIds);
  const watches = await prisma.gmailPushWatch.findMany({
    where: { organizationId },
    select: { email: true },
  });
  const emails = watches.map((w) => w.email);
  const users = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      })
    : [];
  // No reachable Gmail user means the true mail unread total is unknown,
  // even if `extra` carried a freshly-arrived thread id. Unprovable -> null.
  if (users.length === 0) return null;
  for (const u of users) {
    const res = await getUnreadInboxThreadIdsStrict(u.id, { cap: 100 });
    // Any failed lookup makes the combined count unprovable. Bail to null
    // so the caller omits the badge instead of undercounting it.
    if (!res.ok) return null;
    for (const id of res.ids) unread.add(id);
  }
  return unread.size;
}

export async function getUnreadCountsForOrg(
  organizationId: string,
  opts: { extraUnreadMailThreadIds?: string[] } = {},
): Promise<UnreadCounts> {
  const [phoneUnread, mailUnread] = await Promise.all([
    // A thrown local query degrades to null (unprovable), NOT 0, so a DB
    // hiccup can't silently drop the phone portion of the badge.
    getPhoneUnreadForOrg(organizationId).catch(() => null),
    getMailUnreadForOrg(
      organizationId,
      opts.extraUnreadMailThreadIds ?? [],
    ).catch(() => null),
  ]);
  return {
    mailUnread,
    phoneUnread,
    badgeCount: computeBadgeCount({ mailUnread, phoneUnread }),
    mailReliable: mailUnread !== null,
  };
}
