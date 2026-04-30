// Server-side URL verification for AI Workspace job-search outputs.
//
// Why this exists: Claude's web_search routinely returns Google-cached
// or aggregator-snippet entries for job postings that have since closed.
// We were shipping Andrew's candidates to apply links that 404'd or
// showed "this job is no longer open" the moment they clicked through.
// After Claude drafts a Game Plan response, the route extracts every URL
// from the body and fetches it; any URL that returns 404/410, a 4xx, or
// a body that matches a known closed-job pattern is marked dead. The
// route then sends a follow-up turn back to Claude listing the dead
// URLs and asking it to revise — remove dead listings, replace via
// web_search where possible, never pad. The recruiter only sees the
// final revised bubble.
//
// Aggregator domains (LinkedIn, Indeed, ZipRecruiter, Glassdoor, etc.)
// 403 default Node UAs and require auth, so we'd false-positive every
// LinkedIn search URL we tried to fetch. Those are skipped — they're
// always Section-2 broader-search pointers anyway, not specific roles.

export type UrlVerification = {
  url: string;
  alive: boolean;
  reason?: string;
  skipped?: boolean;
};

const FETCH_TIMEOUT_MS = 8_000;

// Aggregator / search-engine hosts. They bot-block default UAs (LinkedIn
// returns 999, Indeed returns 403, etc.), and they're virtually always
// the broader-search "browse N openings" pointers in Section 2 — not
// specific role pages we'd quote in Section 1. Skip them entirely so
// we don't false-positive valid Section-2 links.
const SKIP_VERIFY_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "indeed.com",
  "www.indeed.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "monster.com",
  "www.monster.com",
  "wellfound.com",
  "www.wellfound.com",
  "builtin.com",
  "www.builtin.com",
  "flexjobs.com",
  "www.flexjobs.com",
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
]);

const DEAD_BODY_PATTERNS: RegExp[] = [
  /no longer open/i,
  /no longer accepting applications/i,
  /no longer available/i,
  /position has been filled/i,
  /position is no longer available/i,
  /\bjob\b[^.]{0,40}\bclosed\b/i,
  /\bclosed\b[^.]{0,40}\bjob\b/i,
  /page not found/i,
  /\bjob not found\b/i,
  /404\s*error/i,
  /couldn['’]t find anything/i,
  /job posting you['’]re looking for might have closed/i,
  /the requested page (could not be found|does not exist)/i,
  /this position is closed/i,
  /this requisition is closed/i,
];

export function extractUrls(text: string): string[] {
  const set = new Set<string>();
  // Markdown links [label](https://...) — most common in Game Plan output.
  const md = Array.from(text.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g));
  for (const m of md) {
    set.add(stripTrailingPunct(m[1]));
  }
  // Bare URLs not inside a markdown link.
  const bare = Array.from(text.matchAll(/(?<![\(\[])https?:\/\/[^\s<>)\]"'`]+/g));
  for (const m of bare) {
    set.add(stripTrailingPunct(m[0]));
  }
  return Array.from(set);
}

function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:!?)\]]+$/g, "");
}

export async function verifyUrls(
  urls: string[],
  concurrency = 6,
): Promise<UrlVerification[]> {
  if (urls.length === 0) return [];
  const results = new Array<UrlVerification>(urls.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= urls.length) return;
      results[idx] = await verifyOne(urls[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, urls.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function verifyOne(url: string): Promise<UrlVerification> {
  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return { url, alive: false, reason: "malformed URL" };
  }
  if (SKIP_VERIFY_HOSTS.has(host)) {
    return { url, alive: true, skipped: true, reason: "aggregator host" };
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // Default Node UAs get 403'd by some ATS hosts. Pretend to be
        // a normal Chrome on macOS — these endpoints are public, no
        // auth, no rate-limit concern at our volume.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 410) {
      return { url, alive: false, reason: `HTTP ${res.status}` };
    }
    if (res.status >= 400 && res.status < 500) {
      // Any other 4xx is suspect. 401/403 sometimes wraps a closed job
      // behind auth, sometimes is a bot block — treat as dead so Claude
      // revises rather than shipping a link that bounces.
      return { url, alive: false, reason: `HTTP ${res.status}` };
    }
    if (res.status >= 500) {
      // Transient — assume alive so a flaky upstream doesn't strip a
      // valid listing.
      return { url, alive: true, reason: `HTTP ${res.status} (transient)` };
    }
    const body = await res.text();
    for (const pat of DEAD_BODY_PATTERNS) {
      if (pat.test(body)) {
        return {
          url,
          alive: false,
          reason: `body matches /${pat.source}/`,
        };
      }
    }
    return { url, alive: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return { url, alive: false, reason: msg };
  } finally {
    clearTimeout(timeout);
  }
}
