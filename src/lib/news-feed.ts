import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/claude";

// Shared news-feed plumbing used by both the on-demand /api/news-feed
// route and the daily /api/cron/news-feed pre-warmer. Keeping search
// prompts, JSON parsing, and the Claude call in one place means the
// cron job and the live route can never drift apart.

export const NEWS_TABS = [
  "accounting",
  "recruiting",
  "ai",
  "general",
  "cleveland",
] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

export const SEARCH_PROMPTS: Record<NewsTab, string> = {
  accounting: "latest public accounting CPA firm industry news today",
  recruiting: "recruiting and staffing industry news today",
  ai: "AI technology news today",
  general: "top US news headlines today",
  cleveland: "Cleveland Ohio news today",
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

export function parseHeadlines(raw: string): Headline[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If Claude wrapped the JSON in prose, isolate the first array.
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

const anthropic = new Anthropic();

// Calls Claude with web_search enabled for the given tab and returns the
// parsed Headline[] (or null when the response can't be parsed). Throws
// on transport errors so the caller can decide between fail-fast and
// per-tab fault tolerance.
export async function generateHeadlinesForTab(
  tab: NewsTab,
  generatedDate: Date,
): Promise<Headline[] | null> {
  const system =
    "You are a news curator. Use the web_search tool to gather today's most relevant headlines for the user's topic. Return raw JSON only — no prose, no code fences, no leading explanation. Schema: an array of exactly 6 objects, each {\"headline\": string, \"source\": string (publication name), \"url\": string (canonical article URL), \"summary\": string (one sentence, ≤ 140 chars)}.";
  const userMessage = `Today's date is ${generatedDate.toISOString().slice(0, 10)}. Topic search: ${SEARCH_PROMPTS[tab]}. Return 6 headlines.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  // The final assistant turn after web_search may have multiple text
  // blocks; concatenate so structured output landing in a later block
  // isn't dropped.
  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
  return parseHeadlines(raw);
}
