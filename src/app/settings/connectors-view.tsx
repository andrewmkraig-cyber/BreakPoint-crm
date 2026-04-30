"use client";

import { signIn, signOut } from "next-auth/react";
import { ExternalLink, RefreshCw } from "lucide-react";
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
