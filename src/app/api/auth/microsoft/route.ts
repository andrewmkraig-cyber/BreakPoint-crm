import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Microsoft Graph OAuth — step 1 of the Authorization Code flow used
// to grant Ace permission to create Teams meetings on behalf of the
// signed-in recruiter. Mirrors src/app/api/auth/spotify/route.ts in
// shape: GET kicks off the OAuth handoff, DELETE tears down the
// connection. Unlike Spotify, tokens are persisted in Neon
// (MicrosoftToken) rather than cookies because Teams meeting creation
// happens server-side from interview-actions.ts where cookies aren't
// available.

export const dynamic = "force-dynamic";

export const MICROSOFT_STATE_COOKIE = "ace-ms-state";
const REDIRECT_URI = "https://ace.breakpointtalent.com/api/auth/microsoft/callback";
const SCOPE = [
  "openid",
  "email",
  "profile",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
  "User.Read",
  "offline_access",
].join(" ");

function stateCookieOpts(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function GET() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Microsoft OAuth env vars not configured" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");

  const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_mode", "query");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(MICROSOFT_STATE_COOKIE, state, stateCookieOpts(60 * 10));
  return res;
}

// Disconnect — removes the org's MicrosoftToken row. The next attempt
// to mint a Teams link in interview-actions will see no token and
// fall back to the existing Meet path.
export async function DELETE() {
  try {
    const org = await getCurrentOrg();
    await prisma.microsoftToken.deleteMany({ where: { organizationId: org.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[microsoft-disconnect] failed:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Disconnect failed" },
      { status: 500 },
    );
  }
}
