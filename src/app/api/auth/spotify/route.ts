import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { SPOTIFY_COOKIE, SPOTIFY_SCOPES, spotifyCookieOpts } from "@/lib/spotify";

// Step 1 of the Authorization Code flow. Builds the Spotify
// /authorize URL with our client_id, scopes, and the production
// redirect URI, then 302s the recruiter over there. A random `state`
// token is dropped in a short-lived cookie so the callback can verify
// the response wasn't initiated by a third party.

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Spotify env vars not configured" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SPOTIFY_SCOPES);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  // Short-lived state cookie (10 min) — outlives a slow Spotify auth
  // page interaction but expires before it can be replayed days later.
  res.cookies.set(SPOTIFY_COOKIE.state, state, spotifyCookieOpts(60 * 10));
  return res;
}
