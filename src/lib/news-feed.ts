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

// UI display order: Front Page → Recruiting → Public Accounting → AI &
// Tech. Cron runs through this list to pre-warm tabs in the same order
// the recruiter scans them. The cache @@unique key is keyed on the tab
// string (not the array index), so reordering doesn't invalidate any
// previously cached row — it just changes cron's run/log order.
export const NEWS_TABS = [
  "general",
  "recruiting",
  "accounting",
  "ai",
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
  "Output ONLY the JSON array. No preamble, no commentary, no markdown fences, no trailing text. " +
  'Schema: [{"headline": string, "source": string, "url": string, "summary": string}, ...]. ' +
  "Order matters: the most important / lead story FIRST, then 3 supporting stories. " +
  "Every entry must have a non-empty headline, source name, canonical article URL, and a one-sentence summary. " +
  "All headlines and summaries must be in English. Sources must be reputable English-language news outlets. " +
  "Skip press-release wires (PR Newswire, Business Wire, GlobeNewswire, EIN Presswire, PRWeb), foreign-language sites, aggregator pages, and homepages. " +
  "URLs must point to the specific article, never a section index or Google cache.";

function coerceItem(value: unknown): Headline | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const headline =
    typeof r.headline === "string"
      ? r.headline.trim()
      : typeof r.title === "string"
        ? r.title.trim()
        : "";
  const url =
    typeof r.url === "string"
      ? r.url.trim()
      : typeof r.link === "string"
        ? r.link.trim()
        : "";
  const source =
    typeof r.source === "string"
      ? r.source.trim()
      : typeof r.publication === "string"
        ? r.publication.trim()
        : "";
  const summary =
    typeof r.summary === "string"
      ? r.summary.trim()
      : typeof r.description === "string"
        ? r.description.trim()
        : "";
  if (!headline || !url || !source) return null;
  return { headline, url, source, summary };
}

function clip(arr: Headline[]): Headline[] | null {
  return arr.length === 0 ? null : arr.slice(0, 4);
}

// Strategy 1: the whole text is already valid JSON (best case — Claude
// followed instructions). Strip ```json fences first.
function tryDirectJsonArray(raw: string): Headline[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    const out: Headline[] = [];
    for (const item of parsed) {
      const h = coerceItem(item);
      if (h) out.push(h);
    }
    return clip(out);
  } catch {
    return null;
  }
}

// Strategy 2: a JSON array of objects is embedded somewhere in prose /
// citations footer. Slice from first `[{` to last `}]` and parse.
function tryEmbeddedJsonArray(raw: string): Headline[] | null {
  const start = raw.indexOf("[{");
  const end = raw.lastIndexOf("}]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 2));
    if (!Array.isArray(parsed)) return null;
    const out: Headline[] = [];
    for (const item of parsed) {
      const h = coerceItem(item);
      if (h) out.push(h);
    }
    return clip(out);
  } catch {
    return null;
  }
}

// Strategy 3: numbered list. Splits on lines that start with `N.` /
// `N)` and harvests headline / source / url / summary from each block.
// Tolerant of markdown bold, hyphen separators, and label variations.
function tryNumberedList(raw: string): Headline[] | null {
  const blocks = raw
    .split(/^\s*\d+[.)]\s+/m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (blocks.length < 2) return null;

  const stripMd = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^["'`]|["'`]$/g, "").trim();
  const sourceFromUrl = (url: string): string => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return host.split(".")[0].replace(/^./, (c) => c.toUpperCase());
    } catch {
      return "";
    }
  };

  const out: Headline[] = [];
  for (const block of blocks) {
    const urlMatch = block.match(/https?:\/\/[^\s)\]<>"']+/);
    const url = urlMatch ? urlMatch[0].replace(/[.,;:]+$/, "") : "";

    const labeled = (label: RegExp): string => {
      const m = block.match(label);
      return m ? stripMd(m[1].trim()) : "";
    };

    const headline =
      labeled(/(?:^|\n)\s*(?:\*\*)?(?:headline|title)(?:\*\*)?\s*[:\-—]\s*(.+)/i) ||
      stripMd(block.split(/\n/)[0] ?? "");
    const source =
      labeled(/(?:^|\n)\s*(?:\*\*)?(?:source|publication|outlet)(?:\*\*)?\s*[:\-—]\s*(.+)/i) ||
      sourceFromUrl(url);
    const summary =
      labeled(/(?:^|\n)\s*(?:\*\*)?(?:summary|description)(?:\*\*)?\s*[:\-—]\s*(.+)/i);

    if (!headline || !url || !source) continue;
    out.push({ headline, url, source, summary });
  }
  return clip(out);
}

// Tries every parser in order, logs which one won (or failed). Returns
// null when nothing matches; caller logs the raw snippet.
function parseHeadlines(raw: string, tab: NewsTab): Headline[] | null {
  const direct = tryDirectJsonArray(raw);
  if (direct) {
    console.log(`[news-feed:${tab}] parsed via direct-JSON, count=${direct.length}`);
    return direct;
  }
  const embedded = tryEmbeddedJsonArray(raw);
  if (embedded) {
    console.log(`[news-feed:${tab}] parsed via embedded-JSON, count=${embedded.length}`);
    return embedded;
  }
  const numbered = tryNumberedList(raw);
  if (numbered) {
    console.log(`[news-feed:${tab}] parsed via numbered-list, count=${numbered.length}`);
    return numbered;
  }
  return null;
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
  // Per-tab timeout so a single hung web_search call can't block the rest
  // of the cron (which now runs tabs sequentially) or the on-demand
  // route's 60s ceiling. Narrow-topic searches (recruiting, accounting,
  // ai) routinely take 30-50s, so 55s sits just under the route ceiling.
  const TIMEOUT_MS = 55_000;
  let response;
  try {
    response = await Promise.race([
      anthropic.messages.create({
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
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Claude web_search timed out after ${TIMEOUT_MS / 1000}s for tab "${tab}"`,
              ),
            ),
          TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    // Anthropic.APIError carries .status, .message, and .error (body).
    // Surface every field we can so a 401/429/5xx is visible in Vercel
    // logs without re-running locally.
    const apiErr = err as {
      status?: number;
      message?: string;
      name?: string;
      error?: unknown;
    };
    console.error(`[news-feed:${tab}] Claude API call threw`, {
      name: apiErr?.name,
      status: apiErr?.status,
      message: apiErr?.message,
      error: apiErr?.error,
    });
    throw err;
  }

  // Server-side web_search returns a multi-block sequence:
  //   [ text(preface), server_tool_use, web_search_tool_result, text(answer) ]
  // The JSON we want lives in the trailing text block; the preface is
  // usually "Let me search for...". Concatenate every text block so the
  // parser sees the full final answer plus any preamble.
  const fullText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  // Log the complete raw response BEFORE any parsing. This is the only
  // way to debug "headlines were empty" from Vercel logs alone — the
  // Claude call is non-deterministic so we can't reproduce it locally.
  console.log(`[news-feed:${tab}] raw Claude response`, {
    stop_reason: response.stop_reason,
    block_count: response.content.length,
    block_types: response.content.map((b) => b.type),
    usage: response.usage,
    text_length: fullText.length,
    text: fullText,
  });

  if (!fullText) {
    console.error(`[news-feed:${tab}] no text blocks in response`);
    return null;
  }
  const parsed = parseHeadlines(fullText, tab);
  if (!parsed) {
    console.error(
      `[news-feed:${tab}] all parsers failed, first 500 chars: ${fullText.slice(0, 500)}`,
    );
  }
  return parsed;
}
