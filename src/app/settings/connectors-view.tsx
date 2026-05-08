"use client";

import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { ExternalLink, Loader2, Music, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ConnectorStatus, ConnectorState } from "@/lib/connectors";

// Ace 28.0 Connectors panel — three rows showing the live health of
// each integration. The row UI follows the same shape across all three
// (icon + label + state dot + detail line + right-side action) so the
// recruiter can scan top-to-bottom and immediately see what's broken.
//
// Reconnect semantics:
//   - Gmail: in-Ace re-OAuth loop (signOut → signIn(google))
//   - Claude: no action — pure env config, surface the manage-in-env
//     copy so it's obvious where the key lives
//   - Quo: external link only — Quo doesn't expose a per-user OAuth
//     hand-off, so reconnect happens on quo.com and Ace just keeps
//     using the org-level API key

export function ConnectorsView({
  gmail,
  claude,
  quo,
}: {
  gmail: ConnectorStatus;
  claude: ConnectorStatus;
  quo: ConnectorStatus;
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
              className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
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
        action={
          <div className="flex flex-col items-end gap-1">
            <a
              href="https://my.openphone.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
            >
              <ExternalLink className="h-3 w-3" />
              Open Quo
            </a>
            <span className="text-[11px] italic text-court-fg-muted">
              Sessions are managed at quo.com — sign in there if you got
              logged out.
            </span>
          </div>
        }
      />
      <SpotifyConnectorRow />
    </div>
  );
}

// Spotify connector lives client-side because its session is cookie-
// only (no Neon row, no Google/Quo-style server health check). The
// Disconnect button hits DELETE /api/auth/spotify which expires the
// access / refresh / expires-at cookies; the floating panel's next
// /api/spotify/token call then returns 401 and renders the
// Connect-Spotify CTA. Anchor the row visually like the other
// ConnectorRow entries — same surface, dot, label — without piping a
// real status check up through getAllConnectorStatuses since this
// row's value is mostly the disconnect action.
function SpotifyConnectorRow() {
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/spotify", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
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

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Music className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          <span className="text-sm font-semibold text-court-fg">Spotify</span>
        </div>
        <div className="mt-1 truncate text-xs text-court-fg-muted">
          Floating Spotify panel session. Disconnecting clears the
          access + refresh tokens; reconnect from the panel itself.
        </div>
      </div>
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Disconnect Spotify
        </button>
      </div>
    </div>
  );
}

function ConnectorRow({
  status,
  action,
}: {
  status: ConnectorStatus;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
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
  );
}

function StateDot({ state }: { state: ConnectorState }) {
  const cls =
    state === "connected"
      ? "bg-emerald-500"
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
      ? "text-emerald-700"
      : state === "degraded"
        ? "text-amber-700"
        : "text-red-700";
  return <span className={`text-[11px] font-semibold uppercase tracking-wider ${cls}`}>{text}</span>;
}
