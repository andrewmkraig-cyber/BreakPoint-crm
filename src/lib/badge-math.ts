// Pure, dependency-free badge math so the reliability rule can be unit
// tested without pulling in Prisma or the Gmail client. Used by
// getUnreadCountsForOrg (src/lib/unread-counts.ts) and the four push send
// sites (quo webhook sms+call, gmail webhook, push/fire).
//
// The whole point is the null/0 distinction: a count we cannot PROVE
// (Gmail unreachable, no resolvable user, local SMS query failed) is
// null, never 0. Coercing an unavailable Gmail count to 0 was what let a
// new SMS knock the PWA app badge from 4 down to 1.

export type BadgeInputs = {
  // null = Gmail unread count could not be proven this call.
  mailUnread: number | null;
  // null = local SMS unread query could not be proven this call.
  phoneUnread: number | null;
};

// Returns the combined app-badge count, or null when EITHER side is
// unprovable. A null result must be omitted from the push payload so
// sw.js leaves the existing app badge untouched instead of overwriting a
// known-good number with a partial one.
export function computeBadgeCount(c: BadgeInputs): number | null {
  if (c.mailUnread === null || c.phoneUnread === null) return null;
  return c.mailUnread + c.phoneUnread;
}

// Phone NOTIFICATION badge contract: count unread inbound SMS *messages*,
// NOT unique conversations. Three texts from the same sender are three
// notification items, so they count as 3 - matching how the OS surfaced
// three pushes. Collapsing them to one unread conversation (the old
// behavior) is what kept the badge stuck at 1 no matter how many texts
// arrived from one number.
//
// This is deliberately message-granular and DIFFERENT from the Phone-tab
// left-rail triage badges (/api/phone/threads), which stay conversation-
// granular on purpose (one row per person to reply to). Pure + row-shaped
// so the contract unit-tests without Prisma; both notification sources
// (/api/phone/unread-count + getPhoneUnreadForOrg) feed it the same
// already-filtered rows.
export type SmsUnreadRow = { direction: string; isRead: boolean };
export function phoneUnreadMessageCount(
  rows: ReadonlyArray<SmsUnreadRow>,
): number {
  // Defensive re-filter: callers query inbound+unread already, but
  // re-applying it here makes the contract self-contained and lets the
  // test prove outbound / already-read rows never inflate the count.
  return rows.filter((r) => r.direction === "inbound" && !r.isRead).length;
}

export type BadgePayloadFields = {
  mailUnread: number | null;
  phoneUnread: number | null;
  badgeCount: number;
};

// The badge-related fields to spread into a push payload - or {} when the
// count is unreliable, so the caller omits badgeCount entirely (and with
// it mailUnread/phoneUnread, which only ride along for SW diagnostics).
// sw.js maps a missing badgeCount to "leave the app badge alone".
export function badgePayloadFields(c: {
  mailUnread: number | null;
  phoneUnread: number | null;
  badgeCount: number | null;
}): BadgePayloadFields | Record<string, never> {
  if (c.badgeCount === null) return {};
  return {
    mailUnread: c.mailUnread,
    phoneUnread: c.phoneUnread,
    badgeCount: c.badgeCount,
  };
}
