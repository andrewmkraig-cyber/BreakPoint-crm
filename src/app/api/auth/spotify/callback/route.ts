import { NextRequest, NextResponse } from "next/server";
import {
  SPOTIFY_COOKIE,
  exchangeAuthCode,
  spotifyCookieOpts,
} from "@/lib/spotify";

// Step 2 of the Authorization Code flow. Spotify redirects here after
// the recruiter approves the scopes. We verify the `state` cookie
// matches the one Spotify sent back (CSRF gate), exchange the
// authorization code for the access + refresh token pair, drop them
// into httpOnly cookies, and bounce back to the dashboard. Errors
// from Spotify (user denied, expired code, etc.) surface as a query
// param on the dashboard so the panel can render an error toast.

export const dynamic = "force-dynamic";

const DASHBOARD_PATH = "/dashboard";

function dashboardRedirect(req: NextRequest, error?: string): NextResponse {
  const url = new URL(DASHBOARD_PATH, req.url);
  if (error) url.searchParams.set("spotify_error", error);
  else url.searchParams.set("spotify_connected", "1");
  const res = NextResponse.redirect(url);
  // Always clear the one-shot state cookie on the way out.
  res.cookies.set(SPOTIFY_COOKIE.state, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return dashboardRedirect(req, errorParam);
  }
  if (!code || !state) {
    return dashboardRedirect(req, "missing_code_or_state");
  }

  const cookieState = req.cookies.get(SPOTIFY_COOKIE.state)?.value;
  if (!cookieState || cookieState !== state) {
    return dashboardRedirect(req, "state_mismatch");
  }

  let tokens;
  try {
    tokens = await exchangeAuthCode(code);
  } catch (e) {
    console.error("[spotify-callback] token exchange failed:", e);
    return dashboardRedirect(req, "token_exchange_failed");
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const res = dashboardRedirect(req);
  // Access tokens last ~1h; the cookie maxAge mirrors that so a stale
  // cookie can't outlive its server-side validity. Refresh tokens are
  // long-lived (Spotify rotates them on use); we cap at 30 days for
  // hygiene — the recruiter just reconnects after that.
  res.cookies.set(
    SPOTIFY_COOKIE.access,
    tokens.access_token,
    spotifyCookieOpts(tokens.expires_in),
  );
  res.cookies.set(
    SPOTIFY_COOKIE.expires,
    String(expiresAt),
    spotifyCookieOpts(60 * 60 * 24 * 30),
  );
  if (tokens.refresh_token) {
    res.cookies.set(
      SPOTIFY_COOKIE.refresh,
      tokens.refresh_token,
      spotifyCookieOpts(60 * 60 * 24 * 30),
    );
  }
  return res;
}
