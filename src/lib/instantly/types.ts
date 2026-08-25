// Instantly API v2 response types.
//
// Field names below are taken from the live docs at
// developer.instantly.ai (verified 2026-08-25), not guessed. The ones
// that are easy to get wrong and were checked explicitly:
//   - the list wrapper is { items, next_starting_after }
//   - the reply snippet is `content_preview`, not `snippet` or `preview`
//   - the lead's address is `lead`, not `lead_email`
//   - inbound landing time is `timestamp_email`; `timestamp_created` is
//     when the row was written, which can differ
//   - `is_auto_reply` is a NUMBER-ish flag, not a boolean
//
// Everything the docs mark nullable is nullable here. Optional (`?`) is
// used on top of that where a field may be absent from the payload
// entirely, so a response that omits a key doesn't blow up the mapper.

// Generic paginated list wrapper used by /campaigns and /emails.
export type InstantlyList<T> = {
  items: T[];
  next_starting_after?: string | null;
};

export type InstantlyWorkspace = {
  id: string;
  name: string;
  owner?: string | null;
  timestamp_created?: string | null;
  timestamp_updated?: string | null;
  org_logo_url?: string | null;
};

export type InstantlyCampaign = {
  id: string;
  name: string;
  status?: number | null;
  timestamp_created?: string | null;
  timestamp_updated?: string | null;
};

// GET /campaigns/analytics - one row per campaign.
export type InstantlyCampaignAnalytics = {
  campaign_id: string;
  campaign_name?: string | null;
  campaign_status?: number | null;
  campaign_is_evergreen?: boolean | null;
  leads_count?: number | null;
  contacted_count?: number | null;
  emails_sent_count?: number | null;
  new_leads_contacted_count?: number | null;
  open_count?: number | null;
  open_count_unique?: number | null;
  // GENUINE replies only. Live-verified: this already excludes automatic
  // replies - it is NOT a total that auto-replies are nested inside.
  // Use it directly as the reply number; never subtract from it.
  reply_count?: number | null;
  reply_count_unique?: number | null;
  // Automatic (out-of-office / machine) replies, counted SEPARATELY from
  // reply_count. reply_count + reply_count_automatic = total inbound.
  reply_count_automatic?: number | null;
  reply_count_automatic_unique?: number | null;
  link_click_count?: number | null;
  link_click_count_unique?: number | null;
  bounced_count?: number | null;
  unsubscribed_count?: number | null;
  completed_count?: number | null;
  total_opportunities?: number | null;
  total_opportunity_value?: number | null;
};

// GET /campaigns/analytics/overview - a single aggregate object.
export type InstantlyAnalyticsOverview = {
  open_count?: number | null;
  open_count_unique?: number | null;
  link_click_count?: number | null;
  link_click_count_unique?: number | null;
  reply_count?: number | null;
  reply_count_unique?: number | null;
  reply_count_automatic?: number | null;
  reply_count_automatic_unique?: number | null;
  bounced_count?: number | null;
  unsubscribed_count?: number | null;
  completed_count?: number | null;
  emails_sent_count?: number | null;
  contacted_count?: number | null;
  new_leads_contacted_count?: number | null;
  total_opportunities?: number | null;
  total_opportunity_value?: number | null;
  total_interested?: number | null;
  total_meeting_booked?: number | null;
  total_meeting_completed?: number | null;
  total_closed?: number | null;
};

// GET /campaigns/analytics/daily - one row per day, for trend charts.
export type InstantlyDailyPoint = {
  date: string; // YYYY-MM-DD
  sent?: number | null;
  contacted?: number | null;
  new_leads_contacted?: number | null;
  opened?: number | null;
  unique_opened?: number | null;
  replies?: number | null;
  unique_replies?: number | null;
  replies_automatic?: number | null;
  unique_replies_automatic?: number | null;
  clicks?: number | null;
  unique_clicks?: number | null;
  opportunities?: number | null;
  unique_opportunities?: number | null;
};

// GET /emails - raw unibox row.
export type InstantlyEmailRaw = {
  id: string;
  timestamp_created?: string | null;
  timestamp_email?: string | null;
  message_id?: string | null;
  subject?: string | null;
  from_address_email?: string | null;
  to_address_email_list?: string | null;
  body?: { text?: string | null; html?: string | null } | null;
  campaign_id?: string | null;
  list_id?: string | null;
  lead?: string | null;
  lead_id?: string | null;
  eaccount?: string | null;
  ue_type?: number | null;
  step?: string | null;
  is_unread?: number | boolean | null;
  is_focused?: number | boolean | null;
  is_auto_reply?: number | boolean | null;
  i_status?: number | null;
  thread_id?: string | null;
  content_preview?: string | null;
  ai_interest_value?: number | null;
};

// ---------------------------------------------------------------------
// Normalized reply
//
// What the rest of Ace consumes. Flattens the raw row down to the fields
// Andrew asked for and converts Instantly's number-ish flags to real
// booleans so callers can't trip over `0` being falsy-but-present.
//
// REPLY-RATE RULE (permanent): out-of-office and other machine responses
// must NEVER count toward reply rate, reply counts, or any "they
// responded" signal anywhere in this feature. An OOO bounce-back is not
// interest.
//
// LIVE-VERIFIED CONSTRAINT (2026-08-25): GET /emails does NOT return
// `is_auto_reply` - not on any row, and `preview_only` doesn't change
// it. GET /emails/{id} DOES return it, accurately. Measured on this
// workspace: ~half of inbound is auto-replies (33/66 sampled), and
// Instantly's own analytics reported reply_count_automatic=40 against
// reply_count=26. So this is the common case, not an edge case.
//
// Therefore `isAutoReply` is THREE-STATE, not boolean:
//   true  -> confirmed auto-reply (from /emails/{id})
//   false -> confirmed genuine    (from /emails/{id})
//   null  -> UNKNOWN (straight off the list endpoint, not yet enriched)
//
// `countsAsReply` is true ONLY for a confirmed genuine reply. Unknown
// never counts. That's deliberate: the old boolean defaulted unknown to
// "genuine", which silently counted every OOO as a real reply.
//
// For reply-RATE math, do not derive from this list at all - read
// `reply_count` off /campaigns/analytics, where Instantly does the
// classification server-side for free.
//
// CRITICAL, live-verified 2026-08-25: `reply_count` ALREADY EXCLUDES
// automatic replies. The two counters are DISJOINT, not nested. Measured
// on this workspace: reply_count=26, reply_count_automatic=40, and
// 26 + 40 = 66 = the exact total of inbound emails on the account.
// So NEVER compute `reply_count - reply_count_automatic` - that
// double-subtracts and went negative (-14) the first time it was tried.
// `reply_count` is the genuine-reply number as-is.
// ---------------------------------------------------------------------
export type InstantlyReply = {
  id: string;
  threadId: string | null;
  campaignId: string | null;
  leadEmail: string | null;
  fromEmail: string | null;
  subject: string;
  /** content_preview, falling back to a trimmed body.text. */
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  /** timestamp_email ?? timestamp_created, ISO 8601. */
  receivedAt: string | null;
  /** true = auto-reply, false = genuine, null = not yet determined. */
  isAutoReply: boolean | null;
  /** True ONLY when confirmed genuine. Unknown never counts as a reply. */
  countsAsReply: boolean;
  isUnread: boolean;
  /** Instantly's Focused/Others inbox split. Drives the deep-link mode. */
  isFocused: boolean;
  eaccount: string | null;
};

// ---------------------------------------------------------------------
// Unibox deep link
//
// VERIFIED 2026-08-25 against a real Unibox URL:
//   https://app.instantly.ai/app/unibox/8e-WuLjXxKpS7k1SVJo0haxGG_?mode=emode_focused
//
// The path segment is the row's `thread_id`, confirmed three ways:
//   1. exact match against a sampled row's thread_id
//   2. every thread_id is 26 chars base64url-safe and the segment fits;
//      the email `id` is a 36-char UUID, so it is NOT the email id
//   3. GET /emails?search=thread:<segment> resolved to a thread whose
//      thread_id equals the segment, returning both of its emails
//
// `mode` mirrors the API's documented enum (emode_focused /
// emode_others / emode_all). Only emode_focused appears in a real URL we
// have seen; emode_others is the documented counterpart, used here when
// a row is not focused so an Others-bucket thread still resolves.
// ---------------------------------------------------------------------
const UNIBOX_BASE = "https://app.instantly.ai/app/unibox";

export function instantlyThreadUrl(reply: InstantlyReply): string | null {
  if (!reply.threadId) return null;
  const mode = reply.isFocused ? "emode_focused" : "emode_others";
  return `${UNIBOX_BASE}/${encodeURIComponent(reply.threadId)}?mode=${mode}`;
}

// Instantly returns 0/1 for several boolean-ish flags, and may return a
// real boolean or null. Normalize all three shapes.
export function toBool(v: number | boolean | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return false;
}

// Three-state variant for is_auto_reply specifically. An ABSENT field
// must stay null (unknown), never collapse to false - collapsing is what
// would let an out-of-office count as a genuine reply.
export function toTriBool(v: number | boolean | null | undefined): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  return v !== 0;
}

function firstLine(s: string, max = 200): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export function normalizeReply(raw: InstantlyEmailRaw): InstantlyReply {
  const bodyText = raw.body?.text ?? "";
  // null when the field is absent, which is ALWAYS the case off the list
  // endpoint. countsAsReply below therefore stays false until an
  // enrichment pass confirms the reply is genuine.
  const isAutoReply = toTriBool(raw.is_auto_reply);
  return {
    id: raw.id,
    threadId: raw.thread_id ?? null,
    campaignId: raw.campaign_id ?? null,
    leadEmail: raw.lead ?? null,
    fromEmail: raw.from_address_email ?? null,
    subject: raw.subject ?? "",
    snippet: raw.content_preview?.trim() || firstLine(bodyText),
    bodyText,
    bodyHtml: raw.body?.html ?? "",
    receivedAt: raw.timestamp_email ?? raw.timestamp_created ?? null,
    isAutoReply,
    // Strictly `=== false`: unknown (null) must not count.
    countsAsReply: isAutoReply === false,
    isUnread: toBool(raw.is_unread),
    isFocused: toBool(raw.is_focused),
    eaccount: raw.eaccount ?? null,
  };
}
