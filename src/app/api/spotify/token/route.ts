import { NextResponse } from "next/server";
import {
  SPOTIFY_COOKIE,
  getValidSpotifyAccessToken,
  spotifyCookieOpts,
} from "@/lib/spotify";

// Returns a valid Spotify access_token to the client. The Web
// Playback SDK calls this from getOAuthToken() each time it needs a
// fresh credential, so we transparently refresh the token here when
// the cookied one is within 60s of expiry. The client never sees the
// refresh_token — it stays in the httpOnly cookie store.
//
// 401 with ok:false means the recruiter hasn't connected yet (or the
// refresh token was revoked); the panel reads that signal to render
// the "Connect Spotify" CTA.

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getValidSpotifyAccessToken();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 401 },
    );
  }

  const res = NextResponse.json({
    ok: true,
    access_token: result.accessToken,
  });

  // Persist the refreshed credentials so subsequent reads hit the
  // cached token instead of round-tripping to accounts.spotify.com.
  if (result.refreshed) {
    const expiresAt = Date.now() + result.refreshed.expires_in * 1000;
    res.cookies.set(
      SPOTIFY_COOKIE.access,
      result.refreshed.access_token,
      spotifyCookieOpts(result.refreshed.expires_in),
    );
    res.cookies.set(
      SPOTIFY_COOKIE.expires,
      String(expiresAt),
      spotifyCookieOpts(60 * 60 * 24 * 30),
    );
    if (result.refreshed.refresh_token) {
      res.cookies.set(
        SPOTIFY_COOKIE.refresh,
        result.refreshed.refresh_token,
        spotifyCookieOpts(60 * 60 * 24 * 30),
      );
    }
  }

  return res;
}
