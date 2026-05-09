import { getFreshAccessToken } from "@/lib/gmail";

// Sent-mail recipient typeahead source. The mail composer's To-field
// contacts-search route calls in here so the recruiter sees anyone
// they've previously emailed from Gmail (not just Ace contacts) —
// e.g. receipts@mercury.com, vendors, hiring managers — without us
// having to add a new OAuth scope.
//
// The strategy is a per-user, per-query in-memory cache:
//   1. On miss, ask Gmail to search the user's Sent folder for
//      messages whose To/Cc header contains the query
//      (`in:sent (to:Q OR cc:Q)`). Bcc isn't a Gmail search operator,
//      so bcc-only matches are sacrificed.
//   2. Pull metadata-only headers for up to 10 of those messages in
//      parallel.
//   3. Parse To/Cc/Bcc address lists from the headers, dedupe by
//      lowercased email, and filter back down to addresses whose name
//      or email actually contains the query (multi-recipient headers
//      will surface unrelated co-recipients otherwise).
//   4. Cache for 5 minutes so a debounce burst on the same query
//      doesn't burn 11 Gmail calls per keystroke.
//
// All failure modes return an empty list — the contacts-search route
// merges this in with the Ace-side results, so a Gmail outage just
// hides the gmail-derived suggestions, never breaks the typeahead.

type Cached = {
  expiresAt: number;
  contacts: { name: string; email: string }[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, Cached>();

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const LIST_LIMIT = 15;
const FETCH_LIMIT = 10;

// Loosely parses an RFC 2822 address list. Handles both quoted and
// bare display names: `"Andrew Kraig" <a@b.com>`, `Andrew Kraig
// <a@b.com>`, `a@b.com`. Multiple addresses come comma-separated.
const ADDR_RE = /(?:"([^"]+)"|([^,<]+?))?\s*<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;

function parseAddressList(value: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
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

export async function searchGmailSentRecipients(
  userId: string,
  query: string,
): Promise<{ name: string; email: string }[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const cacheKey = `${userId}:${q}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.contacts;
  }

  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(userId);
  } catch {
    return [];
  }
  const headers = { Authorization: `Bearer ${accessToken}` };

  const gmailQuery = `in:sent (to:${q} OR cc:${q})`;
  const listUrl = `${GMAIL_API}/users/me/messages?maxResults=${LIST_LIMIT}&q=${encodeURIComponent(gmailQuery)}`;
  let listJson: { messages?: { id?: string }[] };
  try {
    const res = await fetch(listUrl, { headers, cache: "no-store" });
    if (!res.ok) {
      cache.set(cacheKey, {
        contacts: [],
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return [];
    }
    listJson = await res.json();
  } catch {
    return [];
  }

  const ids = (listJson.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, FETCH_LIMIT);
  if (ids.length === 0) {
    cache.set(cacheKey, {
      contacts: [],
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return [];
  }

  const headerParams = ["To", "Cc", "Bcc"]
    .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
    .join("&");

  const fetches = ids.map(async (id) => {
    try {
      const res = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=metadata&${headerParams}`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) return [] as { name: string; email: string }[];
      const json = (await res.json()) as {
        payload?: { headers?: { name?: string; value?: string }[] };
      };
      const out: { name: string; email: string }[] = [];
      for (const h of json.payload?.headers ?? []) {
        const hn = (h.name ?? "").toLowerCase();
        if (hn !== "to" && hn !== "cc" && hn !== "bcc") continue;
        if (!h.value) continue;
        out.push(...parseAddressList(h.value));
      }
      return out;
    } catch {
      return [] as { name: string; email: string }[];
    }
  });

  const all = (await Promise.all(fetches)).flat();
  const seen = new Set<string>();
  const filtered: { name: string; email: string }[] = [];
  for (const c of all) {
    const lower = c.email.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    // Multi-recipient messages surface co-recipients we didn't search
    // for — narrow back to entries whose own name/email matches the
    // query before returning.
    if (lower.includes(q) || c.name.toLowerCase().includes(q)) {
      filtered.push(c);
    }
  }

  cache.set(cacheKey, {
    contacts: filtered,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return filtered;
}
