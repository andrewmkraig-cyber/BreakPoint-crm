import { getFreshAccessToken } from "@/lib/gmail";

// Sent-mail recipient snapshot. The mail composer's To-field
// contacts-search route calls in here so the recruiter sees anyone
// they've previously emailed from Gmail (not just Ace contacts) —
// e.g. receipts@mercury.com, vendors, hiring managers — without us
// having to add a new OAuth scope.
//
// Strategy:
//   1. On first call per user, fetch up to SNAPSHOT_LIMIT recent
//      sent message IDs (paginated), then fetch metadata-only
//      headers for each in parallel, parse the To/Cc/Bcc address
//      lists, and dedupe by lowercased email.
//   2. Cache the parsed list in-process per userId for CACHE_TTL_MS.
//      Subsequent typeahead queries filter the cached list locally —
//      no per-keystroke Gmail call.
//   3. On in-flight refresh, all callers await the same Promise so
//      a typeahead burst doesn't fan out 200 metadata calls per
//      keystroke.
//
// We snapshot rather than running `users.messages.list?q=in:sent
// (to:Q OR cc:Q)` per query because Gmail's `to:` operator does
// prefix-of-token, not substring — `to:merc` won't reliably match
// receipts@mercury.com. Local substring filtering on a snapshotted
// list catches every match the recruiter would expect.
//
// All failure modes return []; the contacts-search route merges this
// into the Ace-side results, so a Gmail outage hides the gmail-
// derived rows but never breaks the typeahead.

type Recipient = { name: string; email: string };

type CacheEntry = {
  expiresAt: number;
  recipients: Recipient[];
  loading: Promise<Recipient[]> | null;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_OK_MS = 24 * 60 * 60 * 1000; // serve stale up to 24h while refreshing
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
// Brief specifies 500 max; keeping it there gives a wide history.
// 500 metadata fetches in parallel resolves in ~3-5s on the first
// load and is then cached for 30 min.
const SNAPSHOT_LIMIT = 500;
const LIST_PAGE_SIZE = 100;

const cache = new Map<string, CacheEntry>();

// Loosely parses an RFC 2822 address list. Handles quoted and bare
// display names: `"Andrew Kraig" <a@b.com>`, `Andrew Kraig <a@b.com>`,
// `a@b.com`. Multiple addresses come comma-separated.
const ADDR_RE = /(?:"([^"]+)"|([^,<]+?))?\s*<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;

function parseAddressList(value: string): Recipient[] {
  const out: Recipient[] = [];
  ADDR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDR_RE.exec(value)) !== null) {
    const quotedName = (m[1] ?? "").trim();
    const bareName = (m[2] ?? "").trim();
    const angleEmail = (m[3] ?? "").trim();
    const bareEmail = (m[4] ?? "").trim();
    const email = angleEmail || bareEmail;
    if (!email) continue;
    out.push({ name: quotedName || bareName, email });
  }
  return out;
}

async function listSentMessageIds(
  headers: HeadersInit,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < SNAPSHOT_LIMIT) {
    const params = new URLSearchParams({
      q: "in:sent",
      maxResults: String(LIST_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);
    let res: Response;
    try {
      res = await fetch(`${GMAIL_API}/users/me/messages?${params}`, {
        headers,
        cache: "no-store",
      });
    } catch {
      break;
    }
    if (!res.ok) break;
    const json = (await res.json()) as {
      messages?: { id?: string }[];
      nextPageToken?: string;
    };
    for (const m of json.messages ?? []) {
      if (!m.id) continue;
      ids.push(m.id);
      if (ids.length >= SNAPSHOT_LIMIT) break;
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return ids;
}

async function fetchRecipientsForId(
  id: string,
  headers: HeadersInit,
): Promise<Recipient[]> {
  const headerParams = ["To", "Cc", "Bcc"]
    .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
    .join("&");
  try {
    const res = await fetch(
      `${GMAIL_API}/users/me/messages/${id}?format=metadata&${headerParams}`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      payload?: { headers?: { name?: string; value?: string }[] };
    };
    const out: Recipient[] = [];
    for (const h of json.payload?.headers ?? []) {
      const hn = (h.name ?? "").toLowerCase();
      if (hn !== "to" && hn !== "cc" && hn !== "bcc") continue;
      if (!h.value) continue;
      out.push(...parseAddressList(h.value));
    }
    return out;
  } catch {
    return [];
  }
}

async function loadSnapshot(userId: string): Promise<Recipient[]> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(userId);
  } catch {
    return [];
  }
  const headers = { Authorization: `Bearer ${accessToken}` };

  const ids = await listSentMessageIds(headers);
  if (ids.length === 0) return [];

  // Fan out metadata fetches. All run in parallel — Gmail tolerates
  // bursts at this scale and the cache amortizes the cost across the
  // 30-min TTL window. Failures per-id return [] from
  // fetchRecipientsForId, so a few timeouts don't poison the snapshot.
  const lists = await Promise.all(ids.map((id) => fetchRecipientsForId(id, headers)));

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const list of lists) {
    for (const r of list) {
      const key = r.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

// Kick off (or join) a background snapshot refresh for this user and
// store the in-flight promise on the cache entry so concurrent callers
// coalesce onto it. Returns the promise; callers decide whether to await
// it (blocking) or ignore it (non-blocking warm).
function startRefresh(userId: string, entry: CacheEntry | undefined): Promise<Recipient[]> {
  const promise = loadSnapshot(userId).then((recipients) => {
    const prev = cache.get(userId);
    cache.set(userId, {
      // A failed/empty snapshot keeps whatever we had rather than
      // wiping a good list to [].
      recipients: recipients.length ? recipients : prev?.recipients ?? [],
      expiresAt: Date.now() + CACHE_TTL_MS,
      loading: null,
    });
    return recipients;
  });
  cache.set(userId, {
    recipients: entry?.recipients ?? [],
    expiresAt: entry?.expiresAt ?? 0,
    loading: promise,
  });
  return promise;
}

// Public entry point. Returns the cached snapshot if fresh; otherwise
// kicks off (or joins) a refresh.
//
// `wait` controls cold-cache behavior. The mail composer's typeahead
// passes wait=false so a cold snapshot (up to 500 Gmail header fetches,
// ~3-5s) NEVER blocks the To-field lookup: the route returns the fast
// Ace database matches immediately, the snapshot warms in the
// background, and the Gmail-history rows fold in on the next keystroke
// once it lands. wait=true (the default) preserves blocking semantics
// for any caller that genuinely needs the full list in-line.
export async function getGmailSentRecipients(
  userId: string,
  opts: { wait?: boolean } = {},
): Promise<Recipient[]> {
  const wait = opts.wait ?? true;
  const now = Date.now();
  const entry = cache.get(userId);
  if (entry && entry.expiresAt > now) {
    return entry.recipients;
  }
  // Refresh already in flight. Blocking callers await it; non-blocking
  // callers take whatever's cached now (possibly []) and let it finish
  // in the background.
  if (entry?.loading) {
    return wait ? entry.loading : entry.recipients;
  }
  // Stale-but-recent: serve the old list immediately and refresh in
  // the background regardless of `wait`, so a typeahead never pays for
  // the snapshot every 30 min.
  if (entry && now - entry.expiresAt < STALE_OK_MS && entry.recipients.length > 0) {
    startRefresh(userId, entry);
    return entry.recipients;
  }

  // Cold (or fully expired with nothing usable). Start the snapshot;
  // blocking callers await it, non-blocking callers return [] now and
  // pick up the rows once it warms.
  const promise = startRefresh(userId, entry);
  return wait ? promise : entry?.recipients ?? [];
}
