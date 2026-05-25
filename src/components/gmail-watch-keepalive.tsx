"use client";

import { useEffect } from "react";

// Arms the Gmail INBOX push watch on app-open. This is the "app-open"
// trigger for the silent cross-device mail-badge sync: there is no
// Settings toggle anymore, so opening Ace is what keeps the watch alive
// (the daily renew-gmail-watch cron is the backstop). Fire-and-forget -
// the endpoint is idempotent and only calls Gmail users.watch when the
// watch is missing or near expiry, so this is a cheap no-op on most loads.
// Mounted inside the authed app shell, so it never runs on /sign-in.
export function GmailWatchKeepalive() {
  useEffect(() => {
    void fetch("/api/gmail/watch/ensure", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
