"use client";

import { useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { BellRing, ExternalLink, Loader2, Music, RefreshCw, Video } from "lucide-react";
import { toast } from "sonner";
import { PushPermissionButton } from "@/components/push-permission-button";
import { Button } from "@/components/ui/button";
import { InstantlyNotificationsView } from "@/app/settings/instantly-notifications-view";
import type { InstantlyPrefs } from "@/lib/instantly/prefs";
import type { ConnectorStatus, ConnectorState } from "@/lib/connectors";

// Ace 28.0 Connectors panel - live health of each integration. The row
// UI follows the same shape across every row
// (icon + label + state dot + detail line + right-side action) so the
// recruiter can scan top-to-bottom and immediately see what's broken.
//
// Reconnect semantics:
//   - Gmail: in-Ace re-OAuth loop (signOut → signIn(google))
//   - Claude: no action - pure env config, surface the manage-in-env
//     copy so it's obvious where the key lives
//   - Quo: external link only - Quo doesn't expose a per-user OAuth
//     hand-off, so reconnect happens on quo.com and Ace just keeps
//     using the org-level API key

export function ConnectorsView({
  gmail,
  claude,
  quo,
  instantly,
  instantlyPrefs,
}: {
  gmail: ConnectorStatus;
  claude: ConnectorStatus;
  quo: ConnectorStatus;
  instantly: ConnectorStatus;
  instantlyPrefs: InstantlyPrefs;
}) {
  return (
    <div className="space-y-2">
      <ConnectorRow
        status={gmail}
        action={
          gmail.state === "connected" ? null : (
            <button
              type="button"
              onClick={() => {
                void signOut({ redirect: false }).then(() => {
                  void signIn("google", { callbackUrl: "/settings" });
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect Gmail
            </button>
          )
        }
      />
      <ConnectorRow
        status={claude}
        action={
          <span className="text-[11px] italic text-court-fg-muted">
            Managed in environment config.
          </span>
        }
      />
      <ConnectorRow
        status={quo}
        note="Sessions are managed at quo.com - sign in there if you got logged out."
        action={
          <a
            href="https://my.openphone.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
          >
            <ExternalLink className="h-3 w-3" />
            Open Quo
          </a>
        }
      />
      <InstantlyConnectorRow initial={instantly} prefs={instantlyPrefs} />
      <PushNotificationsRow />
      <MicrosoftTeamsConnectorRow />
      <SpotifyConnectorRow />
    </div>
  );
}

// Microsoft / Teams connector - same client-fetched pattern as
// SpotifyConnectorRow because the OAuth tokens live in Neon
// (MicrosoftToken) and don't flow through getAllConnectorStatuses.
// Status comes from GET /api/auth/microsoft/status; Connect kicks off
// GET /api/auth/microsoft which 302s to login.microsoftonline.com;
// Disconnect calls DELETE /api/auth/microsoft.
type MicrosoftConnState = "connected" | "expired" | "disconnected";

function MicrosoftTeamsConnectorRow() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<MicrosoftConnState>("disconnected");
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/microsoft/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          connected: boolean;
          status?: MicrosoftConnState;
          email: string | null;
        };
        if (cancelled) return;
        setState(json.status ?? (json.connected ? "connected" : "disconnected"));
        setEmail(json.email);
      } catch {
        // Treat a status error as "not connected" - the user can still
        // click Connect; the real OAuth flow will surface any real
        // problem more usefully than a generic toast here.
        if (!cancelled) {
          setState("disconnected");
          setEmail(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = state === "connected";
  const expired = state === "expired";

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/microsoft", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      setState("disconnected");
      setEmail(null);
      toast.success("Microsoft disconnected", {
        description: "Reconnect any time from this panel.",
      });
    } catch (e) {
      toast.error("Couldn't disconnect Microsoft", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  const detail = loading
    ? "Checking connection..."
    : connected
      ? "Connected - Teams meeting links will be generated when scheduling interviews."
      : expired
        ? "Token expired - reconnect to keep generating Teams meeting links when scheduling interviews."
        : "Connect your Microsoft account to generate Teams meeting links when scheduling interviews.";

  return (
    <div
      className={`flex min-h-0 items-start justify-between gap-4 rounded-lg border px-4 py-3 ${
        expired
          ? "border-amber-300 bg-amber-50"
          : "border-court-border bg-court-surface-subtle/40"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Video
            className={`h-3.5 w-3.5 ${expired ? "text-amber-600" : "text-court-brand"}`}
            aria-hidden
          />
          <span className={`text-sm font-semibold ${expired ? "text-amber-900" : "text-court-fg"}`}>
            Microsoft Teams
          </span>
          {!loading && connected && <StateLabel state="connected" />}
          {!loading && expired && (
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              Token expired - reconnect
            </span>
          )}
          {!loading && !connected && !expired && (
            <StateLabel state="disconnected" />
          )}
        </div>
        <div className={`mt-1 truncate text-xs ${expired ? "text-amber-800" : "text-court-fg-muted"}`}>
          {email && (connected || expired) ? (
            <>
              <span className="font-mono">{email}</span> · {detail}
            </>
          ) : (
            detail
          )}
        </div>
      </div>
      <div className="shrink-0">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-court-fg-muted" />
        ) : connected ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Disconnect Microsoft
          </button>
        ) : expired ? (
          <a
            href="/api/auth/microsoft"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
          >
            <RefreshCw className="h-3 w-3" />
            Reconnect Microsoft
          </a>
        ) : (
          <a
            href="/api/auth/microsoft"
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
          >
            <ExternalLink className="h-3 w-3" />
            Connect Microsoft
          </a>
        )}
      </div>
    </div>
  );
}

// PWA web-push device registration. Unlike Gmail / Quo (account-level),
// a push subscription is per-browser, so every device the recruiter
// installs Ace on needs its own opt-in. This row mirrors the live
// subscription state for THIS browser in the standard StateLabel and
// hands the actual subscribe flow to PushPermissionButton. It is also
// the path back after a PWA reinstall: the reinstall wipes the old
// service worker and its subscription, so the row reads Disconnected
// until the user taps Enable here again (no uninstall needed).
function PushNotificationsRow() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const detail =
    connected === null
      ? "Checking this browser's notification registration..."
      : connected
        ? "Active on this browser - alerts push here even when Ace is closed."
        : "Not enabled here. Turn on for alerts, or to re-register after a reinstall.";

  return (
    <div className="flex min-h-0 items-start justify-between gap-4 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <BellRing className="h-3.5 w-3.5 text-court-brand" aria-hidden />
          <span className="text-sm font-semibold text-court-fg">
            Push Notifications
          </span>
          {connected === null ? (
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Checking
            </span>
          ) : (
            <StateLabel state={connected ? "connected" : "disconnected"} />
          )}
        </div>
        <div className="mt-1 truncate text-xs text-court-fg-muted">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {connected === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-court-fg-muted" />
        ) : null}
        <PushPermissionButton
          hideStatusPill
          onStatusChange={(next) => setConnected(next)}
        />
      </div>
    </div>
  );
}

// Spotify connector lives client-side because its session is cookie-
// only (no Neon row, no Google/Quo-style server health check). Status
// comes from GET /api/auth/spotify/status, which validates the cookied
// refresh token and returns only { connected }. Disconnect hits DELETE
// /api/auth/spotify which expires the access / refresh / expires-at
// cookies; reconnect happens from the floating Spotify panel, so this
// row offers no Connect button when disconnected.
function SpotifyConnectorRow() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/spotify/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { connected: boolean };
        if (!cancelled) setConnected(Boolean(json.connected));
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/spotify", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      setConnected(false);
      toast.success("Spotify disconnected", {
        description:
          "Open the floating Spotify panel to reconnect when you're ready.",
      });
    } catch (e) {
      toast.error("Couldn't disconnect Spotify", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  const detail = loading
    ? "Checking connection..."
    : connected
      ? "Floating Spotify panel session. Disconnecting clears the access + refresh tokens; reconnect from the panel itself."
      : "Not connected. Open the floating Spotify panel to connect.";

  return (
    <div className="flex min-h-0 items-start justify-between gap-4 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Music className="h-3.5 w-3.5 text-court-brand" aria-hidden />
          <span className="text-sm font-semibold text-court-fg">Spotify</span>
          {!loading && (
            <StateLabel state={connected ? "connected" : "disconnected"} />
          )}
        </div>
        <div className="mt-1 truncate text-xs text-court-fg-muted">
          {detail}
        </div>
      </div>
      <div className="shrink-0">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-court-fg-muted" />
        ) : connected ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Disconnect Spotify
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Instantly - read-only outbound analytics, key managed in env. The row
// starts from the server-computed status and swaps in whatever the Test
// connection probe reports, so the recruiter can re-check without a page
// reload. There is no key field: the credential lives in env and must
// never be typed into, or rendered by, the browser.
function InstantlyConnectorRow({
  initial,
  prefs,
}: {
  initial: ConnectorStatus;
  prefs: InstantlyPrefs;
}) {
  const [status, setStatus] = useState<ConnectorStatus>(initial);
  const [testing, setTesting] = useState(false);

  async function onTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/instantly/test", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        state: "connected" | "not_configured" | "error";
        workspace: string | null;
        message: string;
        hint?: string;
      };
      setStatus({
        id: "instantly",
        label: "Instantly",
        state:
          data.state === "connected"
            ? "connected"
            : data.state === "not_configured"
              ? "disconnected"
              : "degraded",
        detail: data.message,
        account: data.workspace,
        managedIn: "env",
      });
      if (data.ok) {
        toast.success("Instantly connected", {
          description: data.workspace ? `Workspace: ${data.workspace}` : undefined,
        });
      } else {
        toast.error("Instantly test failed", { description: data.hint ?? data.message });
      }
    } catch (e) {
      toast.error("Instantly test failed", {
        description: e instanceof Error ? e.message : "Could not reach the test route.",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
    <ConnectorRow
      status={status}
      note="Read-only. Ace never sends, replies to, or changes anything in Instantly. Key is managed in environment config."
      action={
        /* Shared Button component, not a raw tag: this file is
           grandfathered in the raw-button baseline and must never grow.
           secondary + sm resolves to the same Court tokens the other
           connector actions use, so the row still matches. */
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onTest()}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Test connection
        </Button>
      }
    />
      {/* Reply-notification settings sit directly under the connector
          row they belong to, rather than in a separate section. */}
      <InstantlyNotificationsView initial={prefs} />
    </div>
  );
}

function ConnectorRow({
  status,
  action,
  note,
}: {
  status: ConnectorStatus;
  action: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="min-h-0 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StateDot state={status.state} />
            <span className="text-sm font-semibold text-court-fg">
              {status.label}
            </span>
            <StateLabel state={status.state} />
          </div>
          <div className="mt-1 truncate text-xs text-court-fg-muted">
            {status.account ? (
              <>
                <span className="font-mono">{status.account}</span> · {status.detail}
              </>
            ) : (
              status.detail
            )}
          </div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {/* Optional helper line wraps full-width BELOW the header row so a
          long note (e.g. Quo's "managed at quo.com" copy) never collides
          with the status label or spills outside the card on mobile. */}
      {note ? (
        <div className="mt-1.5 text-[11px] italic text-court-fg-muted">
          {note}
        </div>
      ) : null}
    </div>
  );
}

function StateDot({ state }: { state: ConnectorState }) {
  const cls =
    state === "connected"
      ? "bg-court-brand"
      : state === "degraded"
        ? "bg-amber-500"
        : "bg-red-500";
  return <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function StateLabel({ state }: { state: ConnectorState }) {
  const text =
    state === "connected"
      ? "Connected"
      : state === "degraded"
        ? "Degraded"
        : "Disconnected";
  const cls =
    state === "connected"
      ? "text-court-brand-dark"
      : state === "degraded"
        ? "text-amber-700"
        : "text-red-700";
  return <span className={`shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider ${cls}`}>{text}</span>;
}
