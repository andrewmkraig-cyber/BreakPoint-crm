import type { NextRequest } from "next/server";
import {
  getCampaignAnalytics,
  getDailyAnalytics,
  listCampaigns,
} from "@/lib/instantly/client";
import { computeCampaignMetrics, computeHeadline } from "@/lib/instantly/metrics";
import { withInstantly } from "@/app/api/instantly/_respond";

export const dynamic = "force-dynamic";

// GET /api/instantly/analytics?campaignId=&startDate=&endDate=
//
// Per-campaign metrics plus the daily trend series that backs the chart
// on the campaign detail page. READ ONLY.
//
// Param naming note: /campaigns/analytics takes id/ids while
// /campaigns/analytics/daily takes campaign_id. The client already
// handles that split - this route just passes a single campaignId.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId") ?? undefined;
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;

  return withInstantly(async () => {
    const [analytics, daily] = await Promise.all([
      getCampaignAnalytics({
        ids: campaignId ? [campaignId] : undefined,
        startDate,
        endDate,
      }),
      getDailyAnalytics({ campaignId, startDate, endDate }),
    ]);

    // Resolve the display name. Analytics carries campaign_name, but a
    // campaign with no analytics row yet would leave the detail page
    // headerless, so fall back to the campaign list.
    let name: string | null = analytics[0]?.campaign_name ?? null;
    let status: number | null = analytics[0]?.campaign_status ?? null;
    if (campaignId && (!name || status === null)) {
      const campaigns = await listCampaigns({ fetchAll: true });
      const match = campaigns.find((c) => c.id === campaignId);
      name = name ?? match?.name ?? null;
      status = status ?? match?.status ?? null;
    }

    return {
      name,
      status,
      headline: computeHeadline(analytics),
      perCampaign: analytics.map(computeCampaignMetrics),
      // Ascending by date so the chart reads left-to-right oldest-first.
      daily: [...daily].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });
}
