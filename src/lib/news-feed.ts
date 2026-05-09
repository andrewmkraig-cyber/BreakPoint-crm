// Shared news-feed plumbing used by both the on-demand /api/news-feed
// route and the daily /api/cron/news-feed pre-warmer. Headlines come
// from Claude with the `web_search_20250305` tool — the cron prewarms
// the four DailyNewsFeed rows at 6am ET so live page loads almost
// always hit cache.

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/claude";

export const NEWS_TABS = [
  "accounting",
  "recruiting",
  "ai",
  "general",
] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

// Per-tab natural-language search query handed to Claude. The search
// instruction is intentionally narrow so each tab returns the right
// vertical — "Front Page" gets US business/financial wire, the other
// three get their respective industries.
const TAB_SEARCH_PROMPTS: Record<NewsTab, string> = {
  general:
    "Search for the top US business and financial news headlines from today",
  accounting:
    "Search for the latest news about CPA firms, public accounting, audit, and tax industry today",
  recruiting:
    "Search for the latest recruiting, hiring, talent market, and staffing industry news today",
  ai: "Search for the most important AI and technology news headlines today",
};

export type Headline = {
  headline: string;
  source: string;
  url: string;
  summary: string;
};

// "Today" in Eastern Time, projected to a UTC-noon Date so the Postgres
// DATE column lands on the intended ET calendar day regardless of where
// the server is running.
export function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

const anthropic = new Anthropic();

function parseHeadlinesJson(raw: string): Headline[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Headline[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const headline = typeof rec.headline === "string" ? rec.headline.trim() : "";
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    const source = typeof rec.source === "string" ? rec.source.trim() : "";
    const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
    if (!headline || !url) continue;
    out.push({
      headline,
      source: source || "Unknown",
      url,
      summary,
    });
    if (out.length === 4) break;
  }
  if (out.length === 0) return null;
  return out;
}

// Asks Claude (with web_search) for today's top 4 stories on the given
// tab and returns them in the Headline shape persisted to
// DailyNewsFeed. Returns null when Claude produced nothing parseable.
// Throws on transport failures so callers can decide between fail-fast
// (cron) and fault-tolerant fallback (live route).
export async function generateHeadlinesForTab(
  tab: NewsTab,
): Promise<Headline[] | null> {
  const todayLabel = todayInEastern().toISOString().slice(0, 10);

  const system =
    "You are a news editor curating today's briefing for a recruiting executive. " +
    "Use the web_search tool to find current articles, then return EXACTLY 4 stories — the single most important story first (the lead), followed by 3 strong supporting stories. " +
    "Respond with raw JSON only — no prose, no code fences, no commentary. " +
    'Schema: [{"headline": string, "source": string, "url": string, "summary": string}]. ' +
    "Rules: headline is the article's actual title; source is the publication name (e.g. \"Reuters\", \"Wall Street Journal\"); url is the canonical article URL; summary is ONE sentence (under 30 words) describing what happened. " +
    "Prefer reputable outlets (Reuters, Bloomberg, WSJ, FT, Axios, AP, NYT, trade press). Avoid press-release wires, sponsored posts, and opinion columns. Prefer stories published today or in the last 24 hours.";

  const userMessage = `Today's date is ${todayLabel}. ${TAB_SEARCH_PROMPTS[tab]}. Return exactly 4 stories as a JSON array.`;

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

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) return null;
  return parseHeadlinesJson(text);
}
