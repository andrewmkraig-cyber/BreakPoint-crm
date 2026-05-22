// Small client-side retry helper for the dashboard's daily companion
// widgets (Word of the Day, Daily Fact, Daily Horoscope). Their backing
// routes call rate-limited upstreams — the Claude API for word-of-day /
// fun-fact, a free public API for horoscope — so the first cold load of
// an ET day can transiently 429/502 while the per-(org, day) cache row
// is still being written. A couple of backed-off retries let one
// attempt land after the rate-limit window passes, which warms the
// cache and keeps every later load that day fast and failure-free.

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 600;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        return res;
      }
    } catch (e) {
      lastError = e;
      if (attempt === retries) throw e;
    }
    // Exponential backoff with a little jitter: ~600ms, then ~1.2s, ...
    const delay = baseDelayMs * 2 ** attempt + Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // Unreachable — the loop always returns or throws on its last pass —
  // but the type checker needs a terminal statement here.
  if (lastError) throw lastError;
  throw new Error("fetchWithRetry: retries exhausted");
}
