// Shared news-feed plumbing used by both the on-demand /api/news-feed
// route and the daily /api/cron/news-feed pre-warmer. Pulls headlines
// live via Claude's web_search tool — NewsAPI returned stale, foreign-
// language, and press-release-padded results that the recruiter had
// to scroll past, so each tab is now an English-only, recency-bound
// search prompt and Claude returns a 4-story JSON payload.
//
// One row per (org, tab, ET day) in DailyNewsFeed: cron pre-warms at
// 6am ET and the on-demand route serves from cache for the rest of
// the day. The refresh button (DELETE /api/news-feed/cache) wipes
// today's rows so the next read regenerates fresh headlines.
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/claude";

export const NEWS_TABS = [
  "accounting",
  "recruiting",
  "ai",
  "general",
] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

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

let cachedClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and to the Vercel project environment.",
    );
  }
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// Per-tab user prompts. Today's date is injected so the model anchors
// recency rather than relying on its training-data sense of "now".
const TAB_PROMPTS: Record<NewsTab, (todayIso: string) => string> = {
  general: (d) =>
    `Search for the top US business and financial news headlines from today, ${d}. Return only English-language articles from US or UK sources published in the last 48 hours.`,
  accounting: (d) =>
    `Search for the latest news about CPA firms, public accounting, audit, and tax industry from today, ${d}. Return only English-language articles from US or UK sources published in the last 48 hours.`,
  recruiting: (d) =>
    `Search for the latest recruiting, hiring, talent market, and staffing industry news from today, ${d}. Return only English-language articles from US or UK sources published in the last 48 hours.`,
  ai: (d) =>
    `Search for the most important AI and technology news headlines from today, ${d}. Return only English-language articles. Prioritize results from TechCrunch, The Verge, Wired, Ars Technica, VentureBeat, or similar major English tech publications. Published in the last 48 hours only.`,
};

const SYSTEM_PROMPT =
  "You are a news researcher for a US recruiting executive's morning briefing. Use the web_search tool to find current headlines, then respond with EXACTLY 4 stories as a JSON array. " +
  "Output ONLY the JSON array — no preamble, no commentary, no markdown fences, no trailing text. " +
  'Schema: [{"headline": string, "source": string, "url": string, "summary": string}, ...]. ' +
  "Order matters: the most important / lead story FIRST, then 3 supporting stories. " +
  "Every entry must have a non-empty headline, source name, canonical article URL, and a one-sentence summary. " +
  "All headlines and summaries must be in English. Sources must be reputable English-language news outlets. " +
  "Skip press-release wires (PR Newswire, Business Wire, GlobeNewswire, EIN Presswire, PRWeb), foreign-language sites, aggregator pages, and homepages. " +
  "URLs must point to the specific article, never a section index or Google cache.";

// Claude wraps the JSON in occasional preamble even when told not to,
// and web_search responses sometimes include a citations footer. Slice
// from the first `[{` to the last `}]` so neither breaks parsing.
function parseHeadlines(raw: string): Headline[] | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("[{");
  const end = trimmed.lastIndexOf("}]");
  if (start === -1 || end === -1 || end < start) return null;
  const slice = trimmed.slice(start, end + 2);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: Headline[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const headline = typeof r.headline === "string" ? r.headline.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const source = typeof r.source === "string" ? r.source.trim() : "";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!headline || !url || !source) continue;
    out.push({ headline, source, url, summary });
    if (out.length === 4) break;
  }
  if (out.length === 0) return null;
  return out;
}

// Calls Claude with the web_search tool and returns the 4-headline payload
// persisted to DailyNewsFeed. Throws on transport / Claude errors so
// callers can decide between fail-fast (cron) and fault-tolerant fallback
// (live route).
export async function generateHeadlinesForTab(
  tab: NewsTab,
): Promise<Headline[] | null> {
  const todayIso = todayInEastern().toISOString().slice(0, 10);
  const userMessage = TAB_PROMPTS[tab](todayIso);

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  // Server-side web_search returns a multi-block sequence:
  //   [ text(preface), server_tool_use, web_search_tool_result, text(answer) ]
  // The JSON we want lives in the trailing text block; the preface is
  // usually "Let me search for...". Concatenate every text block and let
  // parseHeadlines extract the array — it slices from `[{` to `}]` so a
  // chatty preface or citations footer doesn't break parsing.
  const fullText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  if (!fullText) return null;
  return parseHeadlines(fullText);
}
