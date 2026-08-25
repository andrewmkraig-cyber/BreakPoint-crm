import {
  InstantlyError,
  kindForStatus,
  isRetryableKind,
  type InstantlyErrorKind,
} from "@/lib/instantly/errors";
import {
  normalizeReply,
  toTriBool,
  type InstantlyAnalyticsOverview,
  type InstantlyCampaign,
  type InstantlyCampaignAnalytics,
  type InstantlyDailyPoint,
  type InstantlyDailyPoint as DailyPoint,
  type InstantlyEmailRaw,
  type InstantlyList,
  type InstantlyReply,
  type InstantlyWorkspace,
} from "@/lib/instantly/types";

// =====================================================================
// Instantly API v2 client - READ ONLY.
//
// Ace never sends, replies, forwards, creates, pauses, or modifies
// anything in Instantly. This module deliberately exposes NO method that
// issues a POST, PATCH, PUT, or DELETE, and `request()` hard-pins the
// HTTP method to GET (see the guard in request()). Adding a write here
// is a design change, not a small edit - the endpoints exist in the API
// (reply-to-an-email, send-a-test-email, patch-email) and are omitted on
// purpose.
//
// The API key is read from process.env.INSTANTLY_API_KEY and never
// leaves the server. This module must only ever be imported from server
// components, server actions, or route handlers - the browser talks to
// Ace's own /api/instantly/* routes, never to Instantly directly. The
// module-level guard below turns a bad import into a loud crash instead
// of a silently-shipped credential.
//
// Docs verified 2026-08-25 against developer.instantly.ai.
// =====================================================================

if (typeof window !== "undefined") {
  throw new Error(
    "@/lib/instantly/client is server-only - it reads INSTANTLY_API_KEY. " +
      "Call an /api/instantly/* route from the browser instead.",
  );
}

const BASE_URL = "https://api.instantly.ai/api/v2";

// Per-request ceiling. The docs cap /campaigns and /emails at 1-100.
const MAX_PAGE_SIZE = 100;

// Safety net on fetchAll so a huge workspace can't spin forever against
// the 20/min emails budget. 5 pages x 100 = 500 rows per call.
const DEFAULT_MAX_PAGES = 5;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------
// Cache
//
// Keyed by endpoint + sorted query. TTLs are per-endpoint because the
// rate budgets differ wildly: /emails is capped at 20 requests/minute
// (far tighter than the global 100/s + 6000/min), so it gets the
// shortest TTL relative to its budget and the hardest limiter below.
//
// CAVEAT, deliberately not papered over: on Vercel this Map lives in one
// lambda instance. Concurrent instances each keep their own copy, so
// this dampens repeat calls within an instance but is NOT a global
// rate-limit guarantee. A hard cross-instance ceiling would need a
// shared store (Redis / a Neon table). Not built - flagged instead.
// ---------------------------------------------------------------------
type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const TTL_MS = {
  workspace: 60_000,
  campaigns: 5 * 60_000,
  analytics: 5 * 60_000,
  daily: 15 * 60_000,
  emails: 60_000,
} as const;

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Opportunistic sweep so a long-lived instance doesn't accumulate
  // dead entries for one-off query permutations.
  if (cache.size > 200) {
    const now = Date.now();
    // Array.from rather than for..of over the Map: the repo's tsconfig
    // target predates downlevelIteration for Map entries.
    for (const [k, v] of Array.from(cache.entries())) {
      if (now > v.expiresAt) cache.delete(k);
    }
  }
}

/** Drop every cached Instantly response. Used by the Test connection route. */
export function clearInstantlyCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------
// Sliding-window limiter for the /emails bucket (20 requests/minute).
//
// The cache alone can't guarantee this: distinct query params are
// distinct cache keys, so a caller paginating or varying filters could
// still burst past 20. This tracks the timestamps of recent /emails
// calls and WAITS for the oldest to age out rather than throwing - a
// slow read is better than a spurious failure. Same per-instance caveat
// as the cache.
// ---------------------------------------------------------------------
const EMAILS_LIMIT = 20;
const EMAILS_WINDOW_MS = 60_000;
let emailCallTimestamps: number[] = [];

async function acquireEmailsSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    emailCallTimestamps = emailCallTimestamps.filter(
      (t) => now - t < EMAILS_WINDOW_MS,
    );
    if (emailCallTimestamps.length < EMAILS_LIMIT) {
      emailCallTimestamps.push(now);
      return;
    }
    const oldest = emailCallTimestamps[0];
    const waitMs = EMAILS_WINDOW_MS - (now - oldest) + 50;
    await sleep(waitMs);
  }
}

// ---------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireApiKey(): string {
  const key = process.env.INSTANTLY_API_KEY?.trim();
  if (!key) {
    throw new InstantlyError(
      "not_configured",
      "INSTANTLY_API_KEY is not set.",
    );
  }
  return key;
}

export function isInstantlyConfigured(): boolean {
  return Boolean(process.env.INSTANTLY_API_KEY?.trim());
}

type QueryValue = string | number | boolean | undefined | null | string[];

function buildQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      // Instantly's `ids` is an array param - repeat the key.
      for (const item of v) if (item) sp.append(k, item);
    } else {
      sp.set(k, String(v));
    }
  }
  // Sorted so the cache key is stable regardless of argument order.
  sp.sort();
  return sp.toString();
}

// Backoff: ~500ms, 1s, 2s with jitter. Honors Retry-After when the
// response carries it (the docs don't promise the header, so it's read
// defensively rather than relied on).
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  }
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

async function request<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  opts: { ttlMs: number; bucket?: "emails" },
): Promise<T> {
  const key = requireApiKey();
  const qs = buildQuery(params);
  const cacheKey = `${path}?${qs}`;

  const cached = cacheGet<T>(cacheKey);
  if (cached !== null) return cached;

  const url = qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;

  let lastError: InstantlyError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Reserve a slot before every network attempt, retries included -
    // a retry is a real request against the budget too.
    if (opts.bucket === "emails") await acquireEmailsSlot();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        // Hard-pinned to GET. This client is read-only by construction:
        // there is no code path here that can issue a write to Instantly.
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      clearTimeout(timer);
      // Abort / DNS / socket - Instantly is unreachable, not a key problem.
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = new InstantlyError(
        "unavailable",
        isAbort
          ? `Instantly did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
          : `Could not reach Instantly: ${e instanceof Error ? e.message : "network error"}`,
        { endpoint: path, cause: e },
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as T;
      cacheSet(cacheKey, json, opts.ttlMs);
      return json;
    }

    // Body is read BEFORE classifying: Instantly returns scope failures
    // as 401, so status alone would misreport a good key as a bad one.
    const bodyText = await res.text().catch(() => "");
    const kind: InstantlyErrorKind = kindForStatus(res.status, bodyText);
    lastError = new InstantlyError(
      kind,
      `Instantly ${res.status} on ${path}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`,
      { status: res.status, endpoint: path },
    );

    // 401/403/400 can't succeed on retry - fail fast so the real reason
    // surfaces immediately instead of after three pointless round trips.
    if (!isRetryableKind(kind) || attempt === MAX_ATTEMPTS) throw lastError;

    await sleep(backoffMs(attempt, res.headers.get("retry-after")));
  }

  throw lastError ?? new InstantlyError("unavailable", "Instantly request failed.");
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

/** GET /workspaces/current. Needs the workspaces:read scope. */
export async function getWorkspace(): Promise<InstantlyWorkspace> {
  return request<InstantlyWorkspace>("/workspaces/current", {}, {
    ttlMs: TTL_MS.workspace,
  });
}

export type InstantlyProbe = {
  /** Workspace name when we could read it, else null. */
  workspace: string | null;
  /** How we proved the key works. */
  via: "workspace" | "campaigns";
  /** Set when the key works but can't name the workspace. */
  note?: string;
};

/**
 * Connection probe for the Settings row and the Test button.
 *
 * Prefers GET /workspaces/current because it also yields the workspace
 * NAME for the status line. That endpoint needs the workspaces:read
 * scope, which a campaigns+emails-only key does not have - live-verified
 * on 2026-08-25, where it 401'd with "Invalid scope. Required:
 * workspaces:read". A missing scope there does NOT mean the integration
 * is broken: everything Ace actually reads is campaigns + emails.
 *
 * So on a scope failure we fall back to GET /campaigns?limit=1, which
 * exercises a scope the integration genuinely depends on. Any other
 * error (bad key, network, 5xx) propagates - only the scope case falls
 * through.
 *
 * Neither branch touches /emails, so this can never eat into that
 * endpoint's 20-requests-per-minute budget no matter how often the
 * recruiter clicks Test connection.
 */
export async function probeConnection(): Promise<InstantlyProbe> {
  try {
    const ws = await getWorkspace();
    return { workspace: ws.name || ws.id || null, via: "workspace" };
  } catch (e) {
    if (!(e instanceof InstantlyError) || e.kind !== "insufficient_scope") throw e;
    // Key is valid, just not scoped for workspace reads. Prove it
    // against a scope the integration actually uses.
    await request<InstantlyList<InstantlyCampaign>>(
      "/campaigns",
      { limit: 1 },
      { ttlMs: TTL_MS.campaigns },
    );
    return {
      workspace: null,
      via: "campaigns",
      note: "Key lacks workspaces:read, so the workspace name is unavailable. Campaign and reply reads work.",
    };
  }
}

/** GET /campaigns. Follows next_starting_after when fetchAll is set. */
export async function listCampaigns(opts?: {
  limit?: number;
  search?: string;
  status?: number;
  fetchAll?: boolean;
  maxPages?: number;
}): Promise<InstantlyCampaign[]> {
  const limit = Math.min(opts?.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const maxPages = opts?.fetchAll ? (opts.maxPages ?? DEFAULT_MAX_PAGES) : 1;

  const out: InstantlyCampaign[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await request<InstantlyList<InstantlyCampaign>>(
      "/campaigns",
      {
        limit,
        search: opts?.search,
        status: opts?.status,
        starting_after: startingAfter,
      },
      { ttlMs: TTL_MS.campaigns },
    );
    out.push(...(res.items ?? []));
    const next = res.next_starting_after;
    if (!next || (res.items ?? []).length === 0) break;
    startingAfter = next;
  }

  return out;
}

/**
 * GET /campaigns/analytics - per-campaign totals.
 * Note the param split: this endpoint takes `id` (single) / `ids`
 * (multi), while the daily endpoint below takes `campaign_id`.
 */
export async function getCampaignAnalytics(opts?: {
  ids?: string[];
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  excludeTotalLeadsCount?: boolean;
}): Promise<InstantlyCampaignAnalytics[]> {
  const ids = opts?.ids ?? [];
  const res = await request<InstantlyCampaignAnalytics[]>(
    "/campaigns/analytics",
    {
      id: ids.length === 1 ? ids[0] : undefined,
      ids: ids.length > 1 ? ids : undefined,
      start_date: opts?.startDate,
      end_date: opts?.endDate,
      exclude_total_leads_count: opts?.excludeTotalLeadsCount,
    },
    { ttlMs: TTL_MS.analytics },
  );
  return Array.isArray(res) ? res : [];
}

/** GET /campaigns/analytics/overview - one aggregate object. */
export async function getCampaignAnalyticsOverview(opts?: {
  ids?: string[];
  startDate?: string;
  endDate?: string;
  campaignStatus?: number;
}): Promise<InstantlyAnalyticsOverview> {
  const ids = opts?.ids ?? [];
  return request<InstantlyAnalyticsOverview>(
    "/campaigns/analytics/overview",
    {
      id: ids.length === 1 ? ids[0] : undefined,
      ids: ids.length > 1 ? ids : undefined,
      start_date: opts?.startDate,
      end_date: opts?.endDate,
      campaign_status: opts?.campaignStatus,
    },
    { ttlMs: TTL_MS.analytics },
  );
}

/** GET /campaigns/analytics/daily - trend series. Param is campaign_id. */
export async function getDailyAnalytics(opts?: {
  campaignId?: string;
  startDate?: string;
  endDate?: string;
  campaignStatus?: number;
}): Promise<InstantlyDailyPoint[]> {
  const res = await request<DailyPoint[]>(
    "/campaigns/analytics/daily",
    {
      campaign_id: opts?.campaignId,
      start_date: opts?.startDate,
      end_date: opts?.endDate,
      campaign_status: opts?.campaignStatus,
    },
    { ttlMs: TTL_MS.daily },
  );
  return Array.isArray(res) ? res : [];
}

/**
 * GET /emails, pinned to inbound replies.
 *
 * `email_type` is hard-coded to "received" and is NOT overridable - this
 * function cannot be made to return sent mail. Auto-replies come back
 * from Instantly through this same endpoint, so each row carries
 * `isAutoReply` / `countsAsReply`; see the REPLY-RATE RULE in types.ts.
 * By default they are EXCLUDED (`includeAutoReplies: false`) so the
 * careless call is the correct one.
 *
 * Rate note: this endpoint's budget is 20 requests/minute, enforced
 * in-process by acquireEmailsSlot() on top of the response cache.
 */
export async function listReplies(opts?: {
  campaignId?: string;
  since?: string; // ISO 8601
  until?: string;
  latestOfThread?: boolean;
  isUnread?: boolean;
  includeAutoReplies?: boolean;
  limit?: number;
  fetchAll?: boolean;
  maxPages?: number;
}): Promise<InstantlyReply[]> {
  const limit = Math.min(opts?.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const maxPages = opts?.fetchAll ? (opts.maxPages ?? DEFAULT_MAX_PAGES) : 1;

  const out: InstantlyReply[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await request<InstantlyList<InstantlyEmailRaw>>(
      "/emails",
      {
        email_type: "received",
        campaign_id: opts?.campaignId,
        min_timestamp_created: opts?.since,
        max_timestamp_created: opts?.until,
        latest_of_thread: opts?.latestOfThread,
        is_unread: opts?.isUnread,
        sort_order: "desc",
        limit,
        starting_after: startingAfter,
      },
      { ttlMs: TTL_MS.emails, bucket: "emails" },
    );

    out.push(...(res.items ?? []).map(normalizeReply));
    const next = res.next_starting_after;
    if (!next || (res.items ?? []).length === 0) break;
    startingAfter = next;
  }

  // NOTE: no auto-reply filtering happens here. The list endpoint does
  // not carry is_auto_reply (live-verified - see types.ts), so every row
  // comes back with isAutoReply: null / countsAsReply: false. Filtering
  // on countsAsReply at this point would return an empty array.
  // Call enrichAutoReplyFlags() on the rows you intend to show, then
  // filter. `includeAutoReplies` is honored there, not here.
  return out;
}

/**
 * GET /emails/{id} - the ONLY place is_auto_reply is exposed.
 *
 * Live-verified 2026-08-25: the single-email response carries
 * is_auto_reply (1 on an out-of-office, 0 on a genuine reply) and it is
 * the single field the list projection omits.
 */
export async function getEmail(id: string): Promise<InstantlyEmailRaw> {
  return request<InstantlyEmailRaw>(`/emails/${encodeURIComponent(id)}`, {}, {
    ttlMs: TTL_MS.emails,
    bucket: "emails",
  });
}

/**
 * Fill in isAutoReply for a bounded slice of replies.
 *
 * This costs ONE /emails/{id} call per reply against a 20-per-minute
 * budget, so it is deliberately capped (`max`, default 20) and meant for
 * the rows actually on screen - never a whole result set. Rows beyond
 * the cap keep isAutoReply: null / countsAsReply: false, i.e. "unknown,
 * does not count", which is the safe direction: an unclassified reply is
 * never counted as genuine.
 *
 * Do NOT use this to compute reply rate over a campaign. Read
 * reply_count / reply_count_automatic from getCampaignAnalytics(), where
 * Instantly classifies server-side at no request cost.
 *
 * A per-row failure leaves that row unknown rather than failing the
 * batch - one bad id shouldn't blank the whole inbox view.
 */
export async function enrichAutoReplyFlags(
  replies: InstantlyReply[],
  opts?: { max?: number; includeAutoReplies?: boolean },
): Promise<InstantlyReply[]> {
  const max = opts?.max ?? 20;
  const enriched: InstantlyReply[] = [];

  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (reply.isAutoReply !== null || i >= max) {
      enriched.push(reply);
      continue;
    }
    try {
      const full = await getEmail(reply.id);
      const flag = toTriBool(full.is_auto_reply);
      enriched.push({
        ...reply,
        isAutoReply: flag,
        countsAsReply: flag === false,
      });
    } catch {
      // Leave it unknown. Unknown never counts as a genuine reply.
      enriched.push(reply);
    }
  }

  return opts?.includeAutoReplies
    ? enriched
    : enriched.filter((r) => r.isAutoReply !== true);
}
