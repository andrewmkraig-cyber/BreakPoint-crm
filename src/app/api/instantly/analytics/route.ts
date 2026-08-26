import type { NextRequest } from "next/server";
import {
  getCampaignAnalytics,
  getDailyAnalytics,
  listCampaigns,
} from "@/lib/instantly/client";
import {
  mergeCampaignMetrics,
  computeHeadlineFromRows,
} from "@/lib/instantly/metrics";
import { withInstantly } from "@/app/api/instantly/_respond";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

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
    const org = await getCurrentOrg();
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

    // Reply counts from Ace, same as the Overview and the Replies list.
    // Without this the detail tiles would report Instantly's reply_count
    // (which includes our own outbound) while the replies rendered
    // directly beneath them came from Ace - the same tile-vs-list
    // disagreement, one page down. See metrics.ts for the full reasoning
    // and the 180-day coverage caveat.
    const [aceGenuine, aceAuto] = await Promise.all([
      prisma.instantlyReply.count({
        where: {
          organizationId: org.id,
          isOwnSender: false,
          isAutoReply: false,
          ...(campaignId ? { campaignId } : {}),
        },
      }),
      prisma.instantlyReply.count({
        where: {
          organizationId: org.id,
          isOwnSender: false,
          isAutoReply: true,
          ...(campaignId ? { campaignId } : {}),
        },
      }),
    ]);

    const rows = analytics.map((a) =>
      mergeCampaignMetrics(
        a,
        a.campaign_id === campaignId
          ? { genuine: aceGenuine, auto: aceAuto }
          : undefined,
      ),
    );

    return {
      name,
      status,
      headline: computeHeadlineFromRows(rows),
      perCampaign: rows,
      instantlyReplyCount: analytics.reduce((s2, a) => s2 + (a.reply_count ?? 0), 0),
      // Ascending by date so the chart reads left-to-right oldest-first.
      daily: [...daily].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });
}
