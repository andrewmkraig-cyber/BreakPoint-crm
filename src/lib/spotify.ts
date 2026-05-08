import { cookies } from "next/headers";

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
