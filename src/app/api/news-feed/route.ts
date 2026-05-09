import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  NEWS_TABS,
  type NewsTab,
  generateHeadlinesForTab,
  todayInEastern,
} from "@/lib/news-feed";

// On-demand per-tab daily news briefing for the dashboard widget. One
// row per (org, tab, ET day) keyed off DEFAULT_ORG_ID — the first
// request of the ET day spends a Claude web_search call, the rest
// serve from the DailyNewsFeed cache. /api/cron/news-feed prewarms
// the rows at 6am ET so the recruiter usually hits cache.
//
// Intentionally unauthenticated: headlines aren't tenant-private and
// session resolution was the dominant tail-latency source. If
// DEFAULT_ORG_ID is unset we skip the cache entirely and hit Claude
// live every time. DB errors during cache read or upsert are logged
// and swallowed so a Neon hiccup can't take the widget down.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FALLBACK_HEADLINES = [
  {
    headline: "News unavailable — try again shortly",
    source: "Ace",
    url: "#",
    summary: "Could not load headlines. Will retry on next visit.",
  },
];

export async function GET(req: NextRequest) {
  const tabParam = new URL(req.url).searchParams.get("tab") ?? "general";
  if (!(NEWS_TABS as readonly string[]).includes(tabParam)) {
    return NextResponse.json(
      { ok: false, error: `Unknown tab: ${tabParam}` },
      { status: 400 },
    );
  }
  const tab = tabParam as NewsTab;
  const generatedDate = todayInEastern();
  const generatedDateIso = generatedDate.toISOString().slice(0, 10);
  const organizationId = process.env.DEFAULT_ORG_ID;

  const fallbackResponse = () =>
    NextResponse.json({
      ok: true,
      cached: false,
      fallback: true,
      tab,
      generatedDate: generatedDateIso,
      headlines: FALLBACK_HEADLINES,
    });

  if (organizationId) {
    try {
      const cached = await prisma.dailyNewsFeed.findUnique({
        where: {
          organizationId_tab_generatedDate: {
            organizationId,
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
          generatedDate: generatedDateIso,
          headlines: cached.headlines,
        });
      }
    } catch (e) {
      console.error("[news-feed] cache read failed, hitting Claude live:", e);
    }
  }

  let headlines;
  try {
    headlines = await Promise.race([
      generateHeadlinesForTab(tab),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("News feed timed out after 25s")),
          25_000,
        ),
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

  // Best-effort upsert. Skipped without DEFAULT_ORG_ID and never blocks
  // the response — recruiters get the freshly-fetched headlines even if
  // the cache write trips on a DB hiccup; tomorrow's cron will retry.
  if (organizationId) {
    try {
      await prisma.dailyNewsFeed.upsert({
        where: {
          organizationId_tab_generatedDate: {
            organizationId,
            tab,
            generatedDate,
          },
        },
        update: {},
        create: {
          organizationId,
          tab,
          headlines,
          generatedDate,
        },
      });
    } catch (e) {
      console.error(
        "[news-feed] cache upsert failed, returning fresh headlines anyway:",
        e,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    cached: false,
    tab,
    generatedDate: generatedDateIso,
    headlines,
  });
}
