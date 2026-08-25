import { listCampaigns, getCampaignAnalytics } from "@/lib/instantly/client";
import {
  computeCampaignMetrics,
  computeHeadline,
  isActiveCampaignStatus,
  type CampaignMetrics,
} from "@/lib/instantly/metrics";
import { withInstantly } from "@/app/api/instantly/_respond";

export const dynamic = "force-dynamic";

// GET /api/instantly/campaigns
//
// Campaign list joined to per-campaign analytics, plus the headline
// totals. READ ONLY. Every number here originates in
// /campaigns/analytics - none of it is counted from /emails.
//
// The headline is computed over ACTIVE campaigns only (status 1 or 4),
// which is what "across active campaigns" means on the Overview. The
// per-campaign rows are returned unfiltered so the table can show
// paused/completed ones too.

export async function GET() {
  return withInstantly(async () => {
    // Analytics is the source of truth for numbers; the campaign list
    // supplies name/status/timestamps for campaigns analytics may not
    // return a row for (e.g. a draft that never sent).
    const [campaigns, analytics] = await Promise.all([
      listCampaigns({ fetchAll: true }),
      getCampaignAnalytics({}),
    ]);

    const analyticsById = new Map(analytics.map((a) => [a.campaign_id, a]));
    const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
    const updatedById = new Map(
      campaigns.map((c) => [c.id, c.timestamp_updated ?? c.timestamp_created ?? null]),
    );

    // Union: every campaign, whether or not analytics has a row for it.
    const rows: (CampaignMetrics & { lastActivity: string | null })[] = campaigns.map((c) => {
      const a = analyticsById.get(c.id);
      const base = a
        ? computeCampaignMetrics(a)
        : {
            campaignId: c.id,
            name: c.name,
            status: c.status ?? null,
            leadsContacted: 0,
            emailsSent: 0,
            genuineReplies: 0,
            autoReplies: 0,
            bounced: 0,
            replyRate: null,
            bounceRate: null,
          };
      return {
        ...base,
        // Prefer the campaign list's name - analytics occasionally lags a
        // rename.
        name: nameById.get(c.id) ?? base.name,
        status: c.status ?? base.status,
        lastActivity: updatedById.get(c.id) ?? null,
      };
    });

    const activeAnalytics = analytics.filter((a) =>
      isActiveCampaignStatus(a.campaign_status),
    );

    return {
      // Headline across active campaigns; falls back to all campaigns
      // when none are active so the tiles aren't blank on a paused book.
      headline: computeHeadline(
        activeAnalytics.length > 0 ? activeAnalytics : analytics,
      ),
      headlineScope: activeAnalytics.length > 0 ? "active" : "all",
      campaigns: rows,
    };
  });
}
