import type { NextRequest } from "next/server";
import { listCampaigns, getCampaignAnalytics } from "@/lib/instantly/client";
import {
  mergeCampaignMetrics,
  computeHeadlineFromRows,
  isActiveCampaignStatus,
  type AceReplyCounts,
  type CampaignMetrics,
} from "@/lib/instantly/metrics";
import { withInstantly } from "@/app/api/instantly/_respond";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// GET /api/instantly/campaigns?scope=all|active
//
// READ ONLY.
//
// SCOPE drives the tiles AND the table from one filter. They used to be
// computed separately - the headline over Active campaigns only, the
// table over everything - so the tiles read 18 replies while the table
// summed to 27. One scope, one filtered array, and the headline is
// literally the sum of the rows the table renders (see
// computeHeadlineFromRows). They cannot disagree.
//
// Default is `all`: a completed campaign's replies are still replies.
//
// Reply counts come from Ace's DB, volume from Instantly's analytics.
// The reasoning and the 180-day coverage caveat are documented at the
// top of lib/instantly/metrics.ts.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") === "active" ? "active" : "all";

  return withInstantly(async () => {
    const org = await getCurrentOrg();

    const [campaigns, analytics, aceGenuine, aceAuto, aceOwn] = await Promise.all([
      listCampaigns({ fetchAll: true }),
      getCampaignAnalytics({}),
      prisma.instantlyReply.groupBy({
        by: ["campaignId"],
        where: { organizationId: org.id, isOwnSender: false, isAutoReply: false },
        _count: { _all: true },
      }),
      prisma.instantlyReply.groupBy({
        by: ["campaignId"],
        where: { organizationId: org.id, isOwnSender: false, isAutoReply: true },
        _count: { _all: true },
      }),
      // Our own outbound that Instantly files as inbound. Surfaced so the
      // page can explain the delta against Instantly's own dashboard
      // rather than leaving it to be discovered.
      prisma.instantlyReply.count({
        where: { organizationId: org.id, isOwnSender: true },
      }),
    ]);

    const aceByCampaign = new Map<string, AceReplyCounts>();
    for (const g of aceGenuine) {
      if (!g.campaignId) continue;
      const cur = aceByCampaign.get(g.campaignId) ?? { genuine: 0, auto: 0 };
      cur.genuine = g._count._all;
      aceByCampaign.set(g.campaignId, cur);
    }
    for (const g of aceAuto) {
      if (!g.campaignId) continue;
      const cur = aceByCampaign.get(g.campaignId) ?? { genuine: 0, auto: 0 };
      cur.auto = g._count._all;
      aceByCampaign.set(g.campaignId, cur);
    }

    const analyticsById = new Map(analytics.map((a) => [a.campaign_id, a]));

    // One row per campaign, then ONE scope filter applied to that array.
    const allRows: (CampaignMetrics & { lastActivity: string | null })[] = campaigns.map((c) => {
      const a = analyticsById.get(c.id);
      const ace = aceByCampaign.get(c.id);
      const base = a
        ? mergeCampaignMetrics(a, ace)
        : {
            campaignId: c.id,
            name: c.name,
            status: c.status ?? null,
            leadsContacted: 0,
            emailsSent: 0,
            genuineReplies: ace?.genuine ?? 0,
            autoReplies: ace?.auto ?? 0,
            bounced: 0,
            replyRate: null,
            bounceRate: null,
          };
      return {
        ...base,
        name: c.name || base.name,
        status: c.status ?? base.status,
        lastActivity: c.timestamp_updated ?? c.timestamp_created ?? null,
      };
    });

    const rows =
      scope === "active"
        ? allRows.filter((r) => isActiveCampaignStatus(r.status))
        : allRows;

    // Instantly's own reply total for the same scope, so the UI can show
    // why it differs from ours (it counts our outbound as replies).
    const instantlyReplyCount = rows.reduce((sum, r) => {
      const a = analyticsById.get(r.campaignId);
      return sum + (a?.reply_count ?? 0);
    }, 0);

    return {
      scope,
      headline: computeHeadlineFromRows(rows),
      campaigns: rows,
      activeCount: allRows.filter((r) => isActiveCampaignStatus(r.status)).length,
      totalCount: allRows.length,
      // For the explanatory line under the auto-reply banner.
      instantlyReplyCount,
      ownSenderCount: aceOwn,
    };
  });
}
