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
// ---------------------------------------------------------------------
// TWO SOURCES, DELIBERATELY SPLIT.
//
// Volume metrics (leads contacted, emails sent, bounces) come from
// /campaigns/analytics. Instantly is the only thing that knows them.
//
// REPLY counts come from Ace's own InstantlyReply table, because
// Instantly's reply_count includes mail WE sent. Measured 2026-08-26:
// Instantly reported 27 replies across all campaigns while Ace counted
// 24, a delta of exactly 3 - the three replies Andrew sent from his own
// address, which Instantly ingests from the synced mailbox and files as
// inbound (all three in "LA BD Tax Manager": Instantly 7, Ace 4). The
// auto-reply totals agreed exactly (40 = 40), so own-sender rows were
// the entire difference.
//
// Sourcing replies from Ace also makes the headline tiles literally the
// SUM of the campaign table beneath them - see computeHeadlineFromRows.
// They cannot drift apart, which was the original complaint.
//
// >>> COVERAGE CAVEAT - READ BEFORE TRUSTING A REPLY TOTAL <<<
// Ace's reply counts only cover what the poller has mirrored into Neon.
// The cold-start backfill reaches back 180 days (COLD_START_LOOKBACK_MS
// in poller.ts). A campaign whose replies predate that window will
// UNDER-REPORT here relative to Instantly's own analytics, which are
// all-time. As of the backfill on 2026-08-26 all 67 inbound replies were
// stored, so the two agreed except for the own-sender rows above. If a
// reply total ever looks low against Instantly's dashboard, check
// whether the campaign is older than the backfill window before assuming
// a bug. Widening COLD_START_LOOKBACK_MS and re-running a cold start is
// the fix; the per-run enrichment cap keeps that safe to do.
// ---------------------------------------------------------------------
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

/** Reply counts Ace resolved itself, per campaign. */
export type AceReplyCounts = { genuine: number; auto: number };

/**
 * Merge Instantly's volume metrics with Ace's reply counts.
 *
 * Volume (contacted / sent / bounced) is Instantly's - it is the only
 * source. Replies are Ace's, for the reasons at the top of this file.
 * Reply rate is therefore Ace's genuine count over Instantly's contacted
 * count, which is the honest combination: the numerator is the one we
 * can defend, the denominator is the one only Instantly knows.
 *
 * A campaign with no Ace rows yet reports 0 replies rather than falling
 * back to Instantly's number - mixing sources per-row would reintroduce
 * exactly the tile-vs-table disagreement this is meant to remove.
 */
export function mergeCampaignMetrics(
  row: InstantlyCampaignAnalytics,
  ace: AceReplyCounts | undefined,
): CampaignMetrics {
  const base = computeCampaignMetrics(row);
  const genuineReplies = ace?.genuine ?? 0;
  return {
    ...base,
    genuineReplies,
    autoReplies: ace?.auto ?? 0,
    replyRate: rate(genuineReplies, base.leadsContacted),
  };
}

/**
 * Headline totals as the SUM OF THE ROWS the table renders.
 *
 * Not a parallel computation over a different filter - literally the
 * same array. This is what guarantees the tiles and the table agree no
 * matter which scope is selected.
 */
export function computeHeadlineFromRows(rows: CampaignMetrics[]): InstantlyHeadline {
  const totals = rows.reduce(
    (a, r) => ({
      leadsContacted: a.leadsContacted + r.leadsContacted,
      emailsSent: a.emailsSent + r.emailsSent,
      genuineReplies: a.genuineReplies + r.genuineReplies,
      autoReplies: a.autoReplies + r.autoReplies,
      bounced: a.bounced + r.bounced,
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
