import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Per-tab daily news briefing for the dashboard widget. One row per
// (org, tab, ET day): the route checks today's row for the requested
// tab and returns it without calling Claude on subsequent loads. Only
// the first request of the ET day for a given tab spends a Claude
// call (with web_search enabled) — afterwards the headlines stay
// sticky until ET midnight.

export const dynamic = "force-dynamic";
// Web-search-enabled calls can take a while; 60s leaves room for slow
// search providers without tripping Vercel's serverless timeout.
export const maxDuration = 60;

const anthropic = new Anthropic();

const TABS = ["accounting", "recruiting", "ai", "general", "cleveland"] as const;
type Tab = (typeof TABS)[number];

const SEARCH_PROMPTS: Record<Tab, string> = {
  accounting: "latest public accounting CPA firm industry news today",
  recruiting: "recruiting and staffing industry news today",
  ai: "AI technology news today",
  general: "top US news headlines today",
  cleveland: "Cleveland Ohio news today",
};

type Headline = {
  headline: string;
  source: string;
  url: string;
  summary: string;
};

function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function isHeadline(x: unknown): x is Headline {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.headline === "string" &&
    typeof o.source === "string" &&
    typeof o.url === "string" &&
    typeof o.summary === "string"
  );
}

function parseHeadlines(raw: string): Headline[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If Claude wrote prose around the JSON, isolate the first array.
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    const items = parsed.filter(isHeadline);
    if (items.length === 0) return null;
    return items.slice(0, 6);
  } catch {
    return null;
  }
}

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
  if (!(TABS as readonly string[]).includes(tabParam)) {
    return NextResponse.json(
      { ok: false, error: `Unknown tab: ${tabParam}` },
      { status: 400 },
    );
  }
  const tab = tabParam as Tab;

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

  const system =
    "You are a news curator. Use the web_search tool to gather today's most relevant headlines for the user's topic. Return raw JSON only — no prose, no code fences, no leading explanation. Schema: an array of exactly 6 objects, each {\"headline\": string, \"source\": string (publication name), \"url\": string (canonical article URL), \"summary\": string (one sentence, ≤ 140 chars)}.";
  const userMessage = `Today's date is ${generatedDate.toISOString().slice(0, 10)}. Topic search: ${SEARCH_PROMPTS[tab]}. Return 6 headlines.`;

  let headlines: Headline[] | null;
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    // The final assistant turn after web_search may have multiple text
    // blocks (Claude sometimes interleaves search reasoning with
    // structured output). Concatenate every text block before parsing
    // so we don't miss the JSON when it lands in a later block.
    const raw = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");
    headlines = parseHeadlines(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude call failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
  if (!headlines) {
    return NextResponse.json(
      { ok: false, error: "Claude returned no parseable headlines" },
      { status: 502 },
    );
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
