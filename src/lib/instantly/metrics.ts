import type { InstantlyCampaignAnalytics } from "@/lib/instantly/types";

// =====================================================================
// Every derived Instantly number lives HERE and nowhere else.
//
// This file exists because of one specific trap. Instantly's
// `reply_count` and `reply_count_automatic` are DISJOINT counters, not
// nested: live-verified on this workspace as reply_count=26,
// reply_count_automatic=40, summing to 66 = the exact total of inbound
// emails on the account. Subtracting one from the other double-counts
// and goes negative (it produced -14 the first time it was tried).
//
//   genuine replies  = reply_count          (as-is, NEVER a subtraction)
//   auto replies     = reply_count_automatic (reported separately)
//
// The REPLY-RATE RULE: an out-of-office is not interest. Auto-replies
// never fold into the reply number or the reply rate on any surface.
//
// These figures come from /campaigns/analytics ONLY. Never count replies
// by reading /emails - that endpoint is for displaying the reply list,
// is paginated, and cannot be totalled reliably.
// =====================================================================

export type InstantlyHeadline = {
  leadsContacted: number;
  emailsSent: number;
  /** Genuine replies. Excludes auto-replies already. */
  genuineReplies: number;
  /** Auto-replies. Reported separately, never folded into the above. */
  autoReplies: number;
  bounced: number;
  /** genuineReplies / leadsContacted. null when nothing was contacted. */
  replyRate: number | null;
  /** bounced / emailsSent. null when nothing was sent. */
  bounceRate: number | null;
  campaignCount: number;
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Safe rate: null rather than NaN/Infinity when the denominator is 0. */
function rate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return numerator / denominator;
}

export function computeHeadline(
  rows: InstantlyCampaignAnalytics[],
): InstantlyHeadline {
  const totals = rows.reduce(
    (a, r) => ({
      leadsContacted: a.leadsContacted + n(r.contacted_count),
      emailsSent: a.emailsSent + n(r.emails_sent_count),
      // reply_count is ALREADY genuine-only. Do not subtract.
      genuineReplies: a.genuineReplies + n(r.reply_count),
      autoReplies: a.autoReplies + n(r.reply_count_automatic),
      bounced: a.bounced + n(r.bounced_count),
    }),
    { leadsContacted: 0, emailsSent: 0, genuineReplies: 0, autoReplies: 0, bounced: 0 },
  );

  return {
    ...totals,
    replyRate: rate(totals.genuineReplies, totals.leadsContacted),
    bounceRate: rate(totals.bounced, totals.emailsSent),
    campaignCount: rows.length,
  };
}

/** Per-campaign view of the same numbers, for the list table. */
export type CampaignMetrics = {
  campaignId: string;
  name: string;
  status: number | null;
  leadsContacted: number;
  emailsSent: number;
  genuineReplies: number;
  autoReplies: number;
  bounced: number;
  replyRate: number | null;
  bounceRate: number | null;
};

export function computeCampaignMetrics(
  row: InstantlyCampaignAnalytics,
): CampaignMetrics {
  const leadsContacted = n(row.contacted_count);
  const emailsSent = n(row.emails_sent_count);
  const genuineReplies = n(row.reply_count);
  const bounced = n(row.bounced_count);
  return {
    campaignId: row.campaign_id,
    name: row.campaign_name ?? "Untitled campaign",
    status: row.campaign_status ?? null,
    leadsContacted,
    emailsSent,
    genuineReplies,
    autoReplies: n(row.reply_count_automatic),
    bounced,
    replyRate: rate(genuineReplies, leadsContacted),
    bounceRate: rate(bounced, emailsSent),
  };
}

// Instantly campaign status codes. Verified values in use on this
// workspace; the enum in the docs is -99,-1,-2,0,1,2,3,4.
export const CAMPAIGN_STATUS_LABELS: Record<number, string> = {
  [-99]: "Deleted",
  [-2]: "Suspended",
  [-1]: "Paused",
  0: "Draft",
  1: "Active",
  2: "Paused",
  3: "Completed",
  4: "Running subsequences",
};

export function campaignStatusLabel(status: number | null | undefined): string {
  if (status == null) return "Unknown";
  return CAMPAIGN_STATUS_LABELS[status] ?? `Status ${status}`;
}

/** Active = currently sending. Drives the "active campaigns" headline. */
export function isActiveCampaignStatus(status: number | null | undefined): boolean {
  return status === 1 || status === 4;
}

export function formatRate(v: number | null): string {
  if (v === null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

export function formatCount(v: number): string {
  return v.toLocaleString("en-US");
}
