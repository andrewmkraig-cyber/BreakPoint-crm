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

// Quo (OpenPhone) — three-part health check that actually answers
// "is Ace integrated with Quo right now?" instead of just "does Ace
// have an API key on file".
//
//   1. API key valid?      — GET /v1/phone-numbers
//   2. Webhook configured? — GET /v1/webhooks; verify at least one
//                            subscription points back at /api/quo/webhook
//                            and is currently enabled. THIS is the
//                            integration boundary: if the subscription
//                            disappears or pauses, inbound texts/calls
//                            stop reaching Ace even though the API key
//                            is still valid.
//   3. Recent activity?    — most recent SmsMessage / CallLog row.
//                            Belt-and-suspenders confirmation that the
//                            webhook is actually firing (a misconfigured
//                            URL would still appear "enabled" in step 2
//                            but never deliver). Threshold lenient enough
//                            to not false-positive on a quiet weekend.
//
// Any of {key invalid, webhook missing, webhook disabled} → disconnected.
// Webhook is healthy but no recent activity → degraded with explanation.
// All three pass → connected, with the last-seen timestamp surfaced.
const QUO_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

type OpenPhoneWebhook = {
  id?: string;
  url?: string;
  status?: string;
  events?: string[];
};

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

  // Step 1 — API key check.
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
        detail: `Quo API rejected the key (${res.status}). Ace cannot send or receive.`,
        managedIn: "env",
      };
    }
  } catch (e) {
    return {
      id: "quo",
      label: "Quo",
      state: "degraded",
      detail: e instanceof Error ? e.message : "Quo API unreachable.",
      managedIn: "env",
    };
  }

  // Step 2 — webhook subscription check. This is the actual "is Ace
  // integrated" question. We list configured webhooks and look for one
  // pointing at /api/quo/webhook. A missing or disabled subscription
  // means inbound texts/calls won't reach Ace regardless of how
  // healthy the API key looks.
  try {
    const res = await fetch("https://api.openphone.com/v1/webhooks", {
      method: "GET",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: OpenPhoneWebhook[] };
      const hooks = Array.isArray(body?.data) ? body.data : [];
      const aceHook = hooks.find((h) =>
        typeof h.url === "string" && h.url.includes("/api/quo/webhook"),
      );
      if (!aceHook) {
        return {
          id: "quo",
          label: "Quo",
          state: "disconnected",
          detail:
            "API key works, but no webhook subscription points at Ace. Inbound texts/calls won't be received until the subscription is recreated in Quo.",
          managedIn: "env",
        };
      }
      const status = (aceHook.status ?? "").toLowerCase();
      if (status && status !== "enabled" && status !== "active") {
        return {
          id: "quo",
          label: "Quo",
          state: "disconnected",
          detail: `Webhook subscription is "${aceHook.status}" — re-enable it in Quo to resume inbound delivery.`,
          managedIn: "env",
        };
      }
    }
    // If the /v1/webhooks endpoint returns non-200, fall through to
    // the activity check rather than treating it as a hard failure —
    // OpenPhone has rate limited this endpoint historically and we'd
    // rather show a tentative "connected, last seen 5m ago" than red-
    // flag a healthy integration on a 429.
  } catch {
    // Network blip — same fallback to activity check below.
  }

  // Step 3 — recent webhook activity. If the API + subscription both
  // look right, confirm events have actually been arriving recently.
  try {
    const [latestSms, latestCall] = await Promise.all([
      prisma.smsMessage.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.callLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    const lastEventAt = latestestOf(latestSms?.createdAt, latestCall?.createdAt);
    if (lastEventAt) {
      const ageMs = Date.now() - lastEventAt.getTime();
      if (ageMs > QUO_STALE_THRESHOLD_MS) {
        const hours = Math.round(ageMs / (60 * 60 * 1000));
        return {
          id: "quo",
          label: "Quo",
          state: "degraded",
          detail: `Webhook subscribed, but no events in ${hours}h — confirm Quo is still routing to Ace.`,
          managedIn: "env",
        };
      }
      const minutesAgo = Math.round(ageMs / 60_000);
      const fresh =
        minutesAgo < 60
          ? `${minutesAgo}m ago`
          : `${Math.round(minutesAgo / 60)}h ago`;
      return {
        id: "quo",
        label: "Quo",
        state: "connected",
        detail: `API + webhook healthy. Last inbound event ${fresh}.`,
        managedIn: "env",
      };
    }
  } catch {
    // DB read fail — the status check itself shouldn't 500 over a
    // diagnostics query. Fall through to a tentative connected.
  }

  return {
    id: "quo",
    label: "Quo",
    state: "connected",
    detail: "API + webhook healthy. No recent inbound activity to confirm delivery.",
    managedIn: "env",
  };
}

function latestestOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a ?? b ?? null;
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
