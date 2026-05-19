import { NextRequest, NextResponse } from "next/server";

import { MICROSOFT_STATE_COOKIE } from "@/app/api/auth/microsoft/route";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Microsoft Graph OAuth — step 2. Microsoft redirects here after the
// recruiter approves the scopes. We verify the state cookie (CSRF),
// exchange the authorization code for an access + refresh token pair,
// upsert the token row into Neon scoped to the current org, and bounce
// back to /settings/connectors. Errors surface as a query param so the
// connector card can render a toast on next load.

export const dynamic = "force-dynamic";

const SETTINGS_PATH = "/settings/connectors";
const REDIRECT_URI = "https://ace.breakpointtalent.com/api/auth/microsoft/callback";

function settingsRedirect(req: NextRequest, error?: string): NextResponse {
  const url = new URL(SETTINGS_PATH, req.url);
  if (error) url.searchParams.set("microsoft_error", error);
  else url.searchParams.set("microsoft_connected", "1");
  const res = NextResponse.redirect(url);
  res.cookies.set(MICROSOFT_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
};

// id_token is a JWT — we only need the email claim, so a lightweight
// base64url decode of the payload is sufficient. No signature
// verification needed: the token came directly from Microsoft's HTTPS
// token endpoint over the back-channel exchange we just made.
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { email?: string; preferred_username?: string; upn?: string };
    return payload.email ?? payload.preferred_username ?? payload.upn ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) return settingsRedirect(req, errorParam);
  if (!code || !state) return settingsRedirect(req, "missing_code_or_state");

  const cookieState = req.cookies.get(MICROSOFT_STATE_COOKIE)?.value;
  if (!cookieState || cookieState !== state) {
    return settingsRedirect(req, "state_mismatch");
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return settingsRedirect(req, "env_missing");
  }

  let tokens: TokenResponse;
  try {
    const body = new URLSearchParams();
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", REDIRECT_URI);

    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      console.error("[microsoft-callback] token exchange failed:", tokenRes.status, text);
      return settingsRedirect(req, "token_exchange_failed");
    }
    tokens = (await tokenRes.json()) as TokenResponse;
  } catch (e) {
    console.error("[microsoft-callback] token exchange threw:", e);
    return settingsRedirect(req, "token_exchange_failed");
  }

  if (!tokens.refresh_token) {
    // offline_access scope was requested, so refresh_token should be
    // present. If not, we can't keep the connection alive past the
    // initial hour — fail loudly rather than save a token that will
    // silently rot.
    return settingsRedirect(req, "no_refresh_token");
  }

  let org: { id: string };
  try {
    org = await getCurrentOrg();
  } catch (e) {
    console.error("[microsoft-callback] no current org:", e);
    return settingsRedirect(req, "no_session");
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const email = emailFromIdToken(tokens.id_token);

  try {
    await prisma.microsoftToken.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email: email ?? undefined,
        // Reconnecting clears a prior expired flag so the connector card
        // flips back to the green Connected pill.
        status: "connected",
      },
    });
  } catch (e) {
    console.error("[microsoft-callback] token persist failed:", e);
    return settingsRedirect(req, "persist_failed");
  }

  return settingsRedirect(req);
}
