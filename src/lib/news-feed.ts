// Shared news-feed plumbing used by both the on-demand /api/news-feed
// route and the daily /api/cron/news-feed pre-warmer. Pulls headlines
// from NewsAPI.org so each tab returns in well under 2s — the previous
// Claude `web_search` round-trip was timing out under Vercel's
// serverless limits and the recruiter saw a blank widget.

export const NEWS_TABS = [
  "accounting",
  "recruiting",
  "ai",
  "general",
  "cleveland",
] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

// One NewsAPI endpoint per tab. /v2/everything supports keyword +
// sortBy=publishedAt for topic feeds; /v2/top-headlines powers the
// country-wide "Front Page" tab where keyword filtering would only
// narrow it.
const TAB_ENDPOINTS: Record<NewsTab, string> = {
  accounting:
    "https://newsapi.org/v2/everything?q=CPA+accounting+firm&language=en&sortBy=publishedAt",
  recruiting:
    "https://newsapi.org/v2/everything?q=recruiting+staffing+industry&language=en&sortBy=publishedAt",
  ai: "https://newsapi.org/v2/everything?q=artificial+intelligence+technology&language=en&sortBy=publishedAt",
  general: "https://newsapi.org/v2/top-headlines?country=us",
  cleveland:
    "https://newsapi.org/v2/everything?q=Cleveland+Ohio&language=en&sortBy=publishedAt",
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

type NewsApiArticle = {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  source?: { name?: string | null } | null;
};

type NewsApiResponse = {
  status?: string;
  code?: string;
  message?: string;
  articles?: NewsApiArticle[];
};

// Fetches the top NewsAPI articles for the given tab and maps the
// first 6 valid ones into the Headline shape persisted to
// DailyNewsFeed. Throws on transport failures or NewsAPI error
// envelopes so callers can decide between fail-fast (cron) and
// fault-tolerant fallback (live route).
export async function generateHeadlinesForTab(
  tab: NewsTab,
): Promise<Headline[] | null> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error("NEWS_API_KEY env var is not set");

  const res = await fetch(TAB_ENDPOINTS[tab], {
    headers: { "X-Api-Key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as NewsApiResponse;
      detail = body?.message ?? "";
    } catch {
      // body wasn't JSON — fall through with the bare status code
    }
    throw new Error(
      `NewsAPI ${tab} returned ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  const json = (await res.json()) as NewsApiResponse;
  if (json.status && json.status !== "ok") {
    throw new Error(
      `NewsAPI ${tab} status=${json.status}: ${json.message ?? ""}`,
    );
  }

  const articles = json.articles ?? [];
  const headlines: Headline[] = [];
  for (const article of articles) {
    const headline = article.title?.trim();
    const url = article.url?.trim();
    if (!headline || !url) continue;
    headlines.push({
      headline,
      source: article.source?.name?.trim() || "Unknown",
      url,
      summary: article.description?.trim() ?? "",
    });
    if (headlines.length === 6) break;
  }

  if (headlines.length === 0) return null;
  return headlines;
}
