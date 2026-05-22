"use client";

import { signIn, signOut } from "next-auth/react";
import { ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";

// Ace 28.0: slim warning strip used at the top of /mail and /phone
// when the page's primary integration is unhealthy. The action is
// integration-specific:
//   - Gmail: kicks the OAuth re-consent loop (signOut → signIn)
//   - Quo:   external link to my.openphone.com (no in-Ace re-auth)
// Both states are computed server-side; the banner just renders the
// already-known result and renders nothing when status is "connected"
// so the page chrome stays clean on the happy path.

export function ConnectorBanner({
  variant,
  message,
}: {
  variant: "gmail-down" | "quo-down";
  message: string;
}) {
  const isGmail = variant === "gmail-down";

  function onReconnectGmail() {
    // signOut then immediately bounce to /sign-in. The Google
    // provider's prompt:"consent" param re-prompts so a fresh
    // refresh_token is stored on the Account row (see authOptions
    // events.signIn — every sign-in writes the new tokens through).
    void signOut({ redirect: false }).then(() => {
      void signIn("google", { callbackUrl: window.location.pathname });
    });
  }

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {isGmail ? (
        <button
          type="button"
          onClick={onReconnectGmail}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
        >
          <RefreshCw className="h-3 w-3" />
          Reconnect Gmail
        </button>
      ) : (
        <a
          href="https://my.openphone.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
        >
          <ExternalLink className="h-3 w-3" />
          Open Quo
        </a>
      )}
    </div>
  );
}
