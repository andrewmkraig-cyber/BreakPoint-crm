import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayInEastern } from "@/lib/news-feed";

// Manual refresh hook for the dashboard news feed. The recruiter clicks
// the refresh icon in the briefing header → DELETE here wipes today's
// cached DailyNewsFeed rows for all 4 tabs → the next /api/news-feed
// read regenerates fresh headlines via Claude web_search. Scoped to
// DEFAULT_ORG_ID to mirror the on-demand and cron routes (single-tenant
// Ace; we'll iterate over orgs once the CRM grows beyond BreakPoint).

export const dynamic = "force-dynamic";

export async function DELETE() {
  const organizationId = process.env.DEFAULT_ORG_ID;
  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: "DEFAULT_ORG_ID env var is not set" },
      { status: 500 },
    );
  }
  const generatedDate = todayInEastern();
  try {
    const result = await prisma.dailyNewsFeed.deleteMany({
      where: { organizationId, generatedDate },
    });
    return NextResponse.json({
      ok: true,
      deleted: result.count,
      generatedDate: generatedDate.toISOString().slice(0, 10),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[news-feed/cache] delete failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
