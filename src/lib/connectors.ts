import { prisma } from "@/lib/prisma";

// Ace 28.0: server-side health checks for the three integrations the
// recruiter relies on. Surfaces a uniform { state, detail } shape so
// the Connectors panel + the /mail and /phone status banners can read
// the same data and render consistently.
//
// Each check is intentionally cheap and runs server-side on page load
// (no client polling). Gmail uses the existing refresh-token + access-
// token-exchange path; Quo and Claude are env-key driven and ping a
// known endpoint to confirm the key is still valid, not just present.

export type ConnectorState = "connected" | "degraded" | "disconnected";

export type ConnectorStatus = {
  id: "gmail" | "claude" | "quo";
  label: string;
  state: ConnectorState;
  detail: string;
  // Subset of fields rendered by the Connectors UI. Keeping them on
  // the status object (rather than computed in the component) so the
  // /mail and /phone banners can reuse them too.
  account?: string | null;
  managedIn?: "user-oauth" | "env";
};

// Gmail — a connector is "connected" when the Account row for the
// signed-in user has a non-null refresh_token AND we can successfully
// exchange that refresh token for a fresh access token. We don't make
// the actual /gmail/v1 API call here — the token exchange itself is
// already a strong signal that the credential is alive (Google rejects
// expired refresh tokens with 400/401 at the token endpoint).
export async function getGmailStatus(userId: string | null): Promise<ConnectorStatus> {
  if (!userId) {
    return {
      id: "gmail",
      label: "Gmail",
      state: "disconnected",
      detail: "Not signed in.",
      managedIn: "user-oauth",
    };
  }
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      refresh_token: true,
      access_token: true,
      expires_at: true,
      providerAccountId: true,
    },
  });
  if (!account || !account.refresh_token) {
    return {
      id: "gmail",
      label: "Gmail",
      state: "disconnected",
      detail: "No Google refresh token on file.",
      managedIn: "user-oauth",
    };
  }
  // Look up the user's email for display. PrismaAdapter stores the
  // primary email on User.email so this is one lookup.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  // Try to refresh the token. A success means Google still recognizes
  // the refresh token; a 4xx means the user revoked Ace's grant or
  // changed their password.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      id: "gmail",
      label: "Gmail",
      state: "degraded",
      detail: "Google OAuth env vars missing on the server.",
      account: user?.email ?? null,
      managedIn: "user-oauth",
    };
  }
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        id: "gmail",
        label: "Gmail",
        state: "disconnected",
        detail: `Google rejected the refresh token (${res.status}).`,
        account: user?.email ?? null,
        managedIn: "user-oauth",
      };
    }
  } catch (e) {
    return {
      id: "gmail",
      label: "Gmail",
      state: "degraded",
      detail: e instanceof Error ? e.message : "Google token endpoint unreachable.",
      account: user?.email ?? null,
      managedIn: "user-oauth",
    };
  }
  return {
    id: "gmail",
    label: "Gmail",
    state: "connected",
    detail: "Refresh token valid.",
    account: user?.email ?? null,
    managedIn: "user-oauth",
  };
}

// Claude — env-driven. There is no per-user credential, so the only
// thing we can verify is "is ANTHROPIC_API_KEY set?" + a cheap models
// list call to confirm the key hasn't been rotated/revoked. We avoid
// firing a Messages call here because that would burn tokens just to
// render a status dot.
export async function getClaudeStatus(): Promise<ConnectorStatus> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      id: "claude",
      label: "Claude",
      state: "disconnected",
      detail: "ANTHROPIC_API_KEY not set.",
      managedIn: "env",
    };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        id: "claude",
        label: "Claude",
        state: "disconnected",
        detail: `Anthropic API rejected the key (${res.status}).`,
        managedIn: "env",
      };
    }
    return {
      id: "claude",
      label: "Claude",
      state: "connected",
      detail: "API key valid.",
      managedIn: "env",
    };
  } catch (e) {
    return {
      id: "claude",
      label: "Claude",
      state: "degraded",
      detail: e instanceof Error ? e.message : "Anthropic API unreachable.",
      managedIn: "env",
    };
  }
}

// Quo (OpenPhone) — env-driven. /v1/phone-numbers is the canonical
// "is the API key alive" check; the inbound webhook is independent of
// this so a green Connected here means Ace can SEND but not necessarily
// receive (webhook health requires a real inbound message to verify).
// The detail copy makes that clear.
export async function getQuoStatus(): Promise<ConnectorStatus> {
  const key = process.env.QUO_API_KEY;
  if (!key) {
    return {
      id: "quo",
      label: "Quo",
      state: "disconnected",
      detail: "QUO_API_KEY not set.",
      managedIn: "env",
    };
  }
  try {
    const res = await fetch("https://api.openphone.com/v1/phone-numbers", {
      method: "GET",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        id: "quo",
        label: "Quo",
        state: "disconnected",
        detail: `Quo API rejected the key (${res.status}).`,
        managedIn: "env",
      };
    }
    return {
      id: "quo",
      label: "Quo",
      state: "connected",
      detail: "API key valid.",
      managedIn: "env",
    };
  } catch (e) {
    return {
      id: "quo",
      label: "Quo",
      state: "degraded",
      detail: e instanceof Error ? e.message : "Quo API unreachable.",
      managedIn: "env",
    };
  }
}

export async function getAllConnectorStatuses(userId: string | null): Promise<{
  gmail: ConnectorStatus;
  claude: ConnectorStatus;
  quo: ConnectorStatus;
}> {
  const [gmail, claude, quo] = await Promise.all([
    getGmailStatus(userId),
    getClaudeStatus(),
    getQuoStatus(),
  ]);
  return { gmail, claude, quo };
}
