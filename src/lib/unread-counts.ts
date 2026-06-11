import { prisma } from "@/lib/prisma";
import { getUnreadInboxThreadIdsStrict } from "@/lib/gmail";
import { computeBadgeCount, phoneUnreadMessageCount } from "@/lib/badge-math";
import { getQuoLineDigitsForUserId, smsLineWhere } from "@/lib/quo-line-owner";

// Shared snapshot of "what should the PWA app-icon badge read right now"
// for a given org. Three callers stuff this into the push payload so
// sw.js can call setAppBadge with a real total instead of the generic
// dot it fell back to before:
//   - src/app/api/webhooks/gmail/route.ts (new mail tag)
//   - src/app/api/quo/webhook/route.ts (sms + missed call)
//   - src/app/api/push/fire/route.ts (client-relayed pushes)
//
// Reliability is the whole point: a Gmail count we cannot PROVE this call
// (Gmail unreachable, no resolvable user) must never be coerced to 0 -
// that is what let a new SMS knock the badge from 4 down to 1. But fully
// omitting the badge on every Gmail hiccup meant a background text never
// bumped the app badge at all (the symptom: badge only updated after the
// app was opened and the client poll reconciled). So a failed live mail
// lookup now falls back to the last KNOWN-GOOD mail count cached in
// Setting, and the badge math becomes lastKnownGoodMail + livePhone. The
// badge is only omitted in a true cold state - no successful mail count
// has ever been cached - or when the local SMS query itself fails.

// Why the Gmail unread count is / isn't proven this call. Diagnostics
// only - lets the temporary [push][badge-diag] logs separate the three
// cases the badge-down-to-1 bug could come from:
//   - "ok"            Gmail answered; mailUnread is the real count (incl 0)
//   - "no-watch"      no GmailPushWatch / no resolvable user -> mailUnread null
//   - "lookup-failed" a Gmail call threw or returned non-2xx -> mailUnread null
// If a badge ever drops to phone-only again, the log shows whether mail
// was a genuine Gmail 0 (reason "ok", count 0 -> a Gmail/account issue,
// NOT a coercion bug) or an unprovable count that was correctly omitted.
export type MailReason = "ok" | "no-watch" | "lookup-failed";

// Provenance of the mail count actually used for the badge math:
//   "live"            the live Gmail lookup succeeded this call
//   "last-known-good" live lookup failed, fell back to the cached value
//   "none"            live lookup failed and nothing cached yet (cold state)
export type MailSource = "live" | "last-known-good" | "none";

export type UnreadCounts = {
  // The mail count USED for the badge: the live Gmail count when it was
  // proven this call, otherwise the last known-good cached value. null
  // only in a true cold state (no successful mail count ever cached).
  mailUnread: number | null;
  // null when the local SMS unread query failed - same reasoning.
  phoneUnread: number | null;
  // mailUnread + phoneUnread, but ONLY when both are reliable; null
  // otherwise. A null badgeCount is omitted from the push payload, which
  // sw.js maps to "leave the app badge alone".
  badgeCount: number | null;
  // Diagnostics only: was the LIVE Gmail unread count proven this call.
  mailReliable: boolean;
  // Diagnostics only: WHY the live mail lookup did / didn't prove (MailReason).
  mailReason: MailReason;
  // Diagnostics only: whether the badge used a live or last-known-good mail
  // count (or omitted it in cold state).
  mailSource: MailSource;
};

// Last known-good mail count cache, stored in the generic Setting KV so it
// survives across serverless invocations (an in-process cache would not on
// Vercel). Keyed per org so it stays org-scoped without a schema change.
const lastMailKey = (organizationId: string) => `badge:last-mail:${organizationId}`;

async function readLastKnownMail(organizationId: string): Promise<number | null> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: lastMailKey(organizationId) },
      select: { value: true },
    });
    const v = row?.value as { count?: unknown } | null;
    return v && typeof v.count === "number" ? v.count : null;
  } catch {
    return null;
  }
}

async function saveLastKnownMail(
  organizationId: string,
  count: number,
): Promise<void> {
  // Best-effort: a write failure just means the next failed live lookup
  // falls back to an older value (or omits in cold state). Never throws -
  // this runs inside the best-effort push path.
  try {
    const value = { count, at: new Date().toISOString() };
    await prisma.setting.upsert({
      where: { key: lastMailKey(organizationId) },
      update: { value },
      create: { key: lastMailKey(organizationId), value },
    });
  } catch {
    // swallow
  }
}

// Unread inbound SMS *messages* (notification items), not conversations -
// mirrors /api/phone/unread-count/route.ts via the shared
// phoneUnreadMessageCount helper so the push badge and the live-poll
// badge always agree. Five texts from one number count as 5. (Mail stays
// thread-granular, by design - the combined badge is mail threads + phone
// messages.)
async function getPhoneUnreadForOrg(
  organizationId: string,
  phoneLineDigits?: string[],
): Promise<number> {
  if (phoneLineDigits && phoneLineDigits.length === 0) return 0;
  const rows = await prisma.smsMessage.findMany({
    where: {
      organizationId,
      direction: "inbound",
      isRead: false,
      ...(phoneLineDigits ? { AND: [smsLineWhere(phoneLineDigits, "inbound")] } : {}),
    },
    select: { direction: true, isRead: true },
  });
  return phoneUnreadMessageCount(rows);
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
): Promise<{ count: number | null; reason: MailReason }> {
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
  if (users.length === 0) return { count: null, reason: "no-watch" };
  for (const u of users) {
    const res = await getUnreadInboxThreadIdsStrict(u.id, { cap: 100 });
    // Any failed lookup makes the combined count unprovable. Bail to null
    // so the caller omits the badge instead of undercounting it.
    if (!res.ok) return { count: null, reason: "lookup-failed" };
    for (const id of res.ids) unread.add(id);
  }
  return { count: unread.size, reason: "ok" };
}

export async function getUnreadCountsForOrg(
  organizationId: string,
  opts: { extraUnreadMailThreadIds?: string[]; phoneLineDigits?: string[] } = {},
): Promise<UnreadCounts> {
  const [phoneUnread, mail] = await Promise.all([
    // A thrown local query degrades to null (unprovable), NOT 0, so a DB
    // hiccup can't silently drop the phone portion of the badge.
    getPhoneUnreadForOrg(organizationId, opts.phoneLineDigits).catch(() => null),
    // A thrown mail lookup is treated as a failed lookup (count null).
    getMailUnreadForOrg(
      organizationId,
      opts.extraUnreadMailThreadIds ?? [],
    ).catch(
      () => ({ count: null, reason: "lookup-failed" }) as const,
    ),
  ]);

  // Resolve the mail count to use: the live count when proven (and refresh
  // the cache with it), otherwise the last known-good cached value, so a
  // flaky Gmail lookup never freezes the badge for a new background text.
  let effectiveMail: number | null;
  let mailSource: MailSource;
  if (mail.count !== null) {
    effectiveMail = mail.count;
    mailSource = "live";
    await saveLastKnownMail(organizationId, mail.count);
  } else {
    const cached = await readLastKnownMail(organizationId);
    if (cached !== null) {
      effectiveMail = cached;
      mailSource = "last-known-good";
    } else {
      effectiveMail = null;
      mailSource = "none";
    }
  }

  return {
    mailUnread: effectiveMail,
    phoneUnread,
    badgeCount: computeBadgeCount({ mailUnread: effectiveMail, phoneUnread }),
    mailReliable: mail.count !== null,
    mailReason: mail.reason,
    mailSource,
  };
}

export async function getUnreadCountsForUser(
  organizationId: string,
  userId: string,
  opts: { extraUnreadMailThreadIds?: string[] } = {},
): Promise<UnreadCounts> {
  const phoneLineDigits = await getQuoLineDigitsForUserId(organizationId, userId);
  return getUnreadCountsForOrg(organizationId, {
    ...opts,
    phoneLineDigits,
  });
}
