import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Spotify OAuth Authorization Code flow plumbing shared by every
// Spotify-touching API route. The recruiter connects once via the
// /api/auth/spotify redirect chain; thereafter the access_token is
// kept fresh by refreshing it on demand (60s before expiry) using
// the long-lived refresh_token. Both tokens live in httpOnly cookies
// so a stray XSS can't pull them out of document.cookie — the
// signed-in panel still receives the access_token via JSON body
// from /api/spotify/token, but the refresh_token never leaves the
// server.

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-recently-played",
  "user-top-read",
  // user-follow-read powers the Library tab's Artists filter via
  // GET /me/following — without it Spotify 403s the request.
  "user-follow-read",
].join(" ");

export const SPOTIFY_COOKIE = {
  access: "spotify_access_token",
  refresh: "spotify_refresh_token",
  expires: "spotify_expires_at",
  state: "spotify_oauth_state",
} as const;

const REFRESH_BUFFER_MS = 60_000;

type CookieOpts = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export function spotifyCookieOpts(maxAgeSeconds = 60 * 60 * 24 * 30): CookieOpts {
  return {
    httpOnly: true,
    // localhost dev runs over plain HTTP — `secure` would silently
    // refuse to set the cookie there. Vercel prod is HTTPS so it
    // flips on automatically.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export type SpotifyTokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

function basicAuthHeader(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set");
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export async function exchangeAuthCode(
  code: string,
): Promise<SpotifyTokenResponse> {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!redirectUri) throw new Error("SPOTIFY_REDIRECT_URI not set");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Spotify token exchange ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as SpotifyTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify refresh ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as SpotifyTokenResponse;
}

export type ValidTokenResult =
  | {
      ok: true;
      accessToken: string;
      // When the cookied token was still valid this is null. When it
      // expired and we refreshed it, the caller MUST persist the new
      // tokens via response.cookies.set — this lib can't write cookies
      // outside an actual response.
      refreshed: SpotifyTokenResponse | null;
    }
  | { ok: false; error: string };

export function getValidSpotifyAccessToken(): ValidTokenResult | Promise<ValidTokenResult> {
  const store = cookies();
  const accessToken = store.get(SPOTIFY_COOKIE.access)?.value;
  const refreshToken = store.get(SPOTIFY_COOKIE.refresh)?.value;
  const expiresAtRaw = store.get(SPOTIFY_COOKIE.expires)?.value;
  if (!refreshToken) {
    return { ok: false, error: "Not connected" };
  }
  const expiresAt = Number(expiresAtRaw ?? 0);
  if (accessToken && Date.now() < expiresAt - REFRESH_BUFFER_MS) {
    return { ok: true, accessToken, refreshed: null };
  }
  return refreshAccessToken(refreshToken)
    .then(
      (refreshed): ValidTokenResult => ({
        ok: true,
        accessToken: refreshed.access_token,
        refreshed,
      }),
    )
    .catch(
      (e): ValidTokenResult => ({
        ok: false,
        error: e instanceof Error ? e.message : "Refresh failed",
      }),
    );
}

// Mirrors the cookie writes the OAuth callback does, lifted out so
// every API proxy route can apply them after a transparent refresh
// without copying the same five-line block.
export function applyRefreshedSpotifyCookies(
  res: NextResponse,
  refreshed: SpotifyTokenResponse | null,
): NextResponse {
  if (!refreshed) return res;
  const expiresAt = Date.now() + refreshed.expires_in * 1000;
  res.cookies.set(
    SPOTIFY_COOKIE.access,
    refreshed.access_token,
    spotifyCookieOpts(refreshed.expires_in),
  );
  res.cookies.set(
    SPOTIFY_COOKIE.expires,
    String(expiresAt),
    spotifyCookieOpts(60 * 60 * 24 * 30),
  );
  if (refreshed.refresh_token) {
    res.cookies.set(
      SPOTIFY_COOKIE.refresh,
      refreshed.refresh_token,
      spotifyCookieOpts(60 * 60 * 24 * 30),
    );
  }
  return res;
}

export type SpotifyApiOk = {
  ok: true;
  status: number;
  data: unknown;
  refreshed: SpotifyTokenResponse | null;
};
export type SpotifyApiErr = {
  ok: false;
  status: number;
  error: string;
  // Parsed Spotify error body (or raw text if not JSON). Routes use
  // this on 403 to log Spotify's exact reason string. Null when no
  // body was returned (network failure, 204, etc.).
  body: unknown;
  refreshed: SpotifyTokenResponse | null;
};
export type SpotifyApiResult = SpotifyApiOk | SpotifyApiErr;

// Pull only the path + non-credential query off either a relative or
// absolute Spotify URL. We never put auth tokens in query strings —
// they live in the Authorization header — but stripping the host and
// any `access_token` param is defensive in case Spotify ever hands
// back an absolute URL via a `next`/`href` field that embeds one.
function safeEndpoint(path: string): string {
  try {
    const u = path.startsWith("http")
      ? new URL(path)
      : new URL(path, "https://api.spotify.com");
    u.searchParams.delete("access_token");
    return `${u.pathname}${u.search}`;
  } catch {
    return path.split("?")[0] ?? path;
  }
}

// Best-effort summary of Spotify's response body for logs. Counts
// items/total/next-existence; truncates raw error message. No tokens,
// no headers, no full URLs with credentials.
function summarize(data: unknown): {
  itemsCount: number | null;
  total: number | null;
  hasNext: boolean | null;
  errorMessage: string | null;
} {
  if (!data || typeof data !== "object") {
    return { itemsCount: null, total: null, hasNext: null, errorMessage: null };
  }
  const d = data as {
    items?: unknown[];
    total?: number;
    next?: string | null;
    error?: { message?: string; status?: number } | string;
  };
  const itemsCount = Array.isArray(d.items) ? d.items.length : null;
  const total = typeof d.total === "number" ? d.total : null;
  const hasNext = "next" in d ? Boolean(d.next) : null;
  let errorMessage: string | null = null;
  if (typeof d.error === "string") {
    errorMessage = d.error.slice(0, 200);
  } else if (d.error && typeof d.error === "object" && d.error.message) {
    errorMessage = String(d.error.message).slice(0, 200);
  }
  return { itemsCount, total, hasNext, errorMessage };
}

// Single chokepoint for every server-side call to api.spotify.com.
// Resolves a fresh access token (refreshing if needed), forwards the
// request, and tunnels back the raw response code so playback control
// routes can mirror Spotify's 204-no-content acks without parsing.
//
// `tag` is an optional caller-supplied label that shows up in the
// structured log line — let callers pin a request to a specific
// route+step so logs don't blur together when several proxy calls
// fire in parallel for the same request.
export async function spotifyApiProxy(
  path: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    tag?: string;
  },
): Promise<SpotifyApiResult> {
  const endpoint = safeEndpoint(path);
  const tag = init?.tag ?? "spotify-api";
  const method = init?.method ?? "GET";

  const tokenResult = await getValidSpotifyAccessToken();
  if (!tokenResult.ok) {
    console.log(
      "[spotify-api]",
      JSON.stringify({
        tag,
        endpoint,
        method,
        hasAccess: false,
        refreshed: false,
        status: 401,
        error: tokenResult.error,
      }),
    );
    return {
      ok: false,
      status: 401,
      error: tokenResult.error,
      body: null,
      refreshed: null,
    };
  }

  const url = path.startsWith("http") ? path : `https://api.spotify.com${path}`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      body: init?.body,
      cache: "no-store",
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Spotify fetch failed";
    console.log(
      "[spotify-api]",
      JSON.stringify({
        tag,
        endpoint,
        method,
        hasAccess: true,
        refreshed: Boolean(tokenResult.refreshed),
        status: 502,
        error: errMsg,
      }),
    );
    return {
      ok: false,
      status: 502,
      error: errMsg,
      body: null,
      refreshed: tokenResult.refreshed,
    };
  }

  if (upstream.status === 204) {
    console.log(
      "[spotify-api]",
      JSON.stringify({
        tag,
        endpoint,
        method,
        hasAccess: true,
        refreshed: Boolean(tokenResult.refreshed),
        status: 204,
      }),
    );
    return {
      ok: true,
      status: 204,
      data: null,
      refreshed: tokenResult.refreshed,
    };
  }

  const text = await upstream.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  const summary = summarize(data);

  if (!upstream.ok) {
    let error = `Spotify ${upstream.status}`;
    if (summary.errorMessage) {
      error = summary.errorMessage;
    } else if (typeof text === "string" && text.length > 0) {
      error = `${error}: ${text.slice(0, 200)}`;
    }
    console.log(
      "[spotify-api]",
      JSON.stringify({
        tag,
        endpoint,
        method,
        hasAccess: true,
        refreshed: Boolean(tokenResult.refreshed),
        status: upstream.status,
        error,
      }),
    );
    return {
      ok: false,
      status: upstream.status,
      error,
      body: data,
      refreshed: tokenResult.refreshed,
    };
  }

  console.log(
    "[spotify-api]",
    JSON.stringify({
      tag,
      endpoint,
      method,
      hasAccess: true,
      refreshed: Boolean(tokenResult.refreshed),
      status: upstream.status,
      itemsCount: summary.itemsCount,
      total: summary.total,
      hasNext: summary.hasNext,
    }),
  );

  return {
    ok: true,
    status: upstream.status,
    data,
    refreshed: tokenResult.refreshed,
  };
}
