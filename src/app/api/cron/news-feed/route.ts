import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  NEWS_TABS,
  type NewsTab,
  generateHeadlinesForTab,
  todayInEastern,
} from "@/lib/news-feed";

// Daily prewarmer for the dashboard news feed. Vercel cron hits this at
// 11:00 UTC (6am EST / 7am EDT — covers both standard and daylight
// time) so by the time the recruiter opens the dashboard the cached
// DailyNewsFeed rows already exist and /api/news-feed returns from
// cache without spending a Claude call.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Anything
// without that header is rejected — there's no session attached to
// cron invocations so getServerSession can't gate it.
//
// Tabs run sequentially (not in parallel) — concurrent web_search calls
// were occasionally hitting rate limits and competing for socket
// resources, leaving the cron with 1-2 tabs failed. One-at-a-time is
// slower but reliable; each tab is independently try/catch'd so a
// single failure doesn't abort the rest. Result summary lists per-tab
// outcome so a missed tab is visible in the Vercel cron log.

export const dynamic = "force-dynamic";
// Sequential 4 tabs × 30s timeout each = 120s worst case. 180s leaves
// headroom for parsing, DB writes, and any slow tab that runs to
// timeout before the next one starts.
export const maxDuration = 180;

const DEFAULT_ORG_FALLBACK = "DEFAULT_ORG_ID";

type TabOutcome =
  | { tab: NewsTab; status: "skipped"; reason: "cached" }
  | { tab: NewsTab; status: "generated"; count: number }
  | { tab: NewsTab; status: "failed"; error: string };

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  // Vercel sends `Bearer <secret>`; accept that exact form.
  return header === `Bearer ${expected}`;
}

async function processTab(
  tab: NewsTab,
  organizationId: string,
  generatedDate: Date,
): Promise<TabOutcome> {
  // Cache check first — if today's row already exists for this org/tab,
  // skip the Claude call entirely. Idempotent: re-running the cron
  // doesn't double-spend the model.
  const existing = await prisma.dailyNewsFeed.findUnique({
    where: {
      organizationId_tab_generatedDate: {
        organizationId,
        tab,
        generatedDate,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { tab, status: "skipped", reason: "cached" };
  }

  let headlines;
  try {
    headlines = await generateHeadlinesForTab(tab);
  } catch (e) {
    return {
      tab,
      status: "failed",
      error: e instanceof Error ? e.message : "headline generation failed",
    };
  }
  if (!headlines) {
    return { tab, status: "failed", error: "no parseable headlines" };
  }

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
  return { tab, status: "generated", count: headlines.length };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Cron runs without a session, so we resolve org via the env fallback
  // (same DEFAULT_ORG_ID that getCurrentOrg falls back to). When the
  // CRM grows past the single BreakPoint Talent org we'll iterate over
  // all orgs here.
  const organizationId = process.env.DEFAULT_ORG_ID;
  if (!organizationId) {
    return NextResponse.json(
      {
        ok: false,
        error: `${DEFAULT_ORG_FALLBACK} env var not set — cron has no org to scope to`,
      },
      { status: 500 },
    );
  }

  const generatedDate = todayInEastern();

  // Sequential per-tab loop: one web_search at a time. Each tab is
  // independently try/catch'd via processTab so a timeout or parse miss
  // on tab N doesn't abort tab N+1.
  const results: TabOutcome[] = [];
  for (const tab of NEWS_TABS) {
    try {
      results.push(await processTab(tab, organizationId, generatedDate));
    } catch (e) {
      results.push({
        tab,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const summary = {
    generated: results.filter((r) => r.status === "generated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return NextResponse.json({
    ok: true,
    generatedDate: generatedDate.toISOString().slice(0, 10),
    organizationId,
    summary,
    results,
  });
}
