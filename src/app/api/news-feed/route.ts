import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  NEWS_TABS,
  type NewsTab,
  generateHeadlinesForTab,
  todayInEastern,
} from "@/lib/news-feed";

// On-demand per-tab daily news briefing for the dashboard widget. One
// row per (org, tab, ET day): the route checks today's row for the
// requested tab and returns it without calling Claude on subsequent
// loads. Only the first request of the ET day for a given tab spends a
// Claude call (with web_search enabled) — afterwards the headlines
// stay sticky until ET midnight. The /api/cron/news-feed prewarmer
// fires at 6am ET so by the time the recruiter opens the dashboard the
// rows already exist and this route returns from cache.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();

  const tabParam = new URL(req.url).searchParams.get("tab") ?? "general";
  if (!(NEWS_TABS as readonly string[]).includes(tabParam)) {
    return NextResponse.json(
      { ok: false, error: `Unknown tab: ${tabParam}` },
      { status: 400 },
    );
  }
  const tab = tabParam as NewsTab;
  const generatedDate = todayInEastern();

  const cached = await prisma.dailyNewsFeed.findUnique({
    where: {
      organizationId_tab_generatedDate: {
        organizationId: org.id,
        tab,
        generatedDate,
      },
    },
  });
  if (cached) {
    return NextResponse.json({
      ok: true,
      cached: true,
      tab,
      generatedDate: generatedDate.toISOString().slice(0, 10),
      headlines: cached.headlines,
    });
  }

  const FALLBACK_HEADLINES = [
    {
      headline: "News unavailable — try again shortly",
      source: "Ace",
      url: "#",
      summary: "Could not load headlines. Will retry on next visit.",
    },
  ];
  const fallbackResponse = () =>
    NextResponse.json({
      ok: true,
      cached: false,
      fallback: true,
      tab,
      generatedDate: generatedDate.toISOString().slice(0, 10),
      headlines: FALLBACK_HEADLINES,
    });

  let headlines;
  try {
    headlines = await Promise.race([
      generateHeadlinesForTab(tab, generatedDate),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("News feed timed out after 25s")), 25_000),
      ),
    ]);
  } catch (e) {
    console.error("[news-feed] generation failed, serving fallback:", e);
    return fallbackResponse();
  }
  if (!headlines) {
    console.error("[news-feed] no parseable headlines, serving fallback");
    return fallbackResponse();
  }

  // Upsert in case a concurrent request beat us to the insert — the
  // unique (org, tab, generatedDate) constraint would otherwise throw.
  const row = await prisma.dailyNewsFeed.upsert({
    where: {
      organizationId_tab_generatedDate: {
        organizationId: org.id,
        tab,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      tab,
      headlines,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    tab,
    generatedDate: generatedDate.toISOString().slice(0, 10),
    headlines: row.headlines,
  });
}
