import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, GOOGLE_SCOPES } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Diagnostic — inspects the Google OAuth state for the signed-in user.
// Returns what scopes we requested, what's stored on the Account row, and
// what Google's tokeninfo says the current access token actually carries.
// Use this when API calls start 401ing or when a new scope isn't taking
// effect after a re-auth.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "google" },
    select: {
      provider: true,
      providerAccountId: true,
      token_type: true,
      scope: true,
      expires_at: true,
      access_token: true,
      refresh_token: true,
    },
  });

  // Live check against Google: tokeninfo returns the scopes actually
  // associated with the access token. Lets us compare against what we
  // believe should be there.
  let tokenInfo:
    | { status: number; scopes: string[]; raw: Record<string, unknown> }
    | { status: number; error: string }
    | null = null;
  if (account?.access_token) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(account.access_token)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        const scope = typeof body.scope === "string" ? body.scope : "";
        tokenInfo = {
          status: res.status,
          scopes: scope.split(/\s+/).filter(Boolean),
          raw: body,
        };
      } else {
        tokenInfo = {
          status: res.status,
          error: typeof body.error === "string" ? body.error : JSON.stringify(body).slice(0, 300),
        };
      }
    } catch (e) {
      tokenInfo = { status: 0, error: e instanceof Error ? e.message : "unknown" };
    }
  }

  const dbScopes = account?.scope?.split(/\s+/).filter(Boolean) ?? [];
  const liveScopes =
    tokenInfo && "scopes" in tokenInfo ? tokenInfo.scopes : null;
  // Google normalizes "email" → "https://www.googleapis.com/auth/userinfo.email"
  // and "profile" → "https://www.googleapis.com/auth/userinfo.profile" in the
  // scope strings it returns. Our expected set uses the short names, so
  // compare with this aliasing so we don't report false missing-scopes.
  const scopeAliases: Record<string, string[]> = {
    email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
    profile: ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
  };
  const hasScope = (scope: string, granted: string[]): boolean => {
    const aliases = scopeAliases[scope] ?? [scope];
    return aliases.some((a) => granted.includes(a));
  };
  const missingOnDb = GOOGLE_SCOPES.filter((s) => !hasScope(s, dbScopes));
  const missingOnLive = liveScopes
    ? GOOGLE_SCOPES.filter((s) => !hasScope(s, liveScopes))
    : null;

  return NextResponse.json(
    {
      user: { email: user.email, name: user.name },
      expectedScopes: GOOGLE_SCOPES,
      account: account
        ? {
            providerAccountId: account.providerAccountId,
            tokenType: account.token_type,
            storedScope: account.scope,
            storedScopes: dbScopes,
            missingFromStoredScopes: missingOnDb,
            expiresAt: account.expires_at,
            expiresAtIso: account.expires_at ? new Date(account.expires_at * 1000).toISOString() : null,
            accessTokenPresent: Boolean(account.access_token),
            accessTokenTailHint: account.access_token
              ? `${account.access_token.slice(-6)} (last 6 chars)`
              : null,
            refreshTokenPresent: Boolean(account.refresh_token),
          }
        : null,
      tokenInfo,
      missingFromLiveScopes: missingOnLive,
      guidance: buildGuidance({
        accountExists: Boolean(account),
        refreshTokenPresent: Boolean(account?.refresh_token),
        missingOnDb,
        missingOnLive,
        tokenInfoStatus: tokenInfo?.status ?? null,
      }),
    },
    { status: 200 },
  );
}

function buildGuidance(input: {
  accountExists: boolean;
  refreshTokenPresent: boolean;
  missingOnDb: string[];
  missingOnLive: string[] | null;
  tokenInfoStatus: number | null;
}): string[] {
  const out: string[] = [];
  if (!input.accountExists) {
    out.push("No Google Account row on file. Sign in at /sign-in.");
    return out;
  }
  if (!input.refreshTokenPresent) {
    out.push("refresh_token missing on the Account row. Sign out, then sign in again — Google only returns a refresh_token when prompt=consent is honored.");
  }
  if (input.tokenInfoStatus === 400) {
    out.push("tokeninfo returned 400. The access_token is likely expired or revoked. Sign in again to get a fresh one.");
  }
  if (input.missingOnDb.length > 0) {
    out.push(
      `DB Account.scope is missing: ${input.missingOnDb.join(", ")}. Google did not grant these at last sign-in. Two likely causes: (a) the scope isn't registered in Google Cloud Console → OAuth consent screen → Scopes, or (b) the scope requires verification and this project is in Testing mode without you listed as a test user.`,
    );
  }
  if (input.missingOnLive && input.missingOnLive.length > 0) {
    out.push(
      `Live tokeninfo is missing: ${input.missingOnLive.join(", ")}. Your current access token does not carry these scopes regardless of what the DB says. Revoke Ace at https://myaccount.google.com/permissions, sign in again, then reload this page.`,
    );
  }
  if (out.length === 0) {
    out.push("All expected scopes present on both the stored Account row and the live access token. If API calls still fail, the issue is downstream (wrong API endpoint, quota, etc.), not OAuth.");
  }
  return out;
}
