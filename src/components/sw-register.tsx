"use client";
import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Auto-apply new builds. sw.js calls skipWaiting()+clients.claim(), so a
    // freshly-deployed worker takes control without a manual refresh — but the
    // page is still running the PREVIOUS build's JS until it reloads. Without
    // this, installed iOS PWAs keep painting the stale cached shell (a "restart"
    // there often just resumes the suspended app, never re-fetching) until the
    // user deletes and reinstalls by hand. Reload once when control changes.
    // Guarded on an existing controller so this only fires on a real UPDATE,
    // never on the first worker claiming a fresh page load (which would reload
    // every brand-new visit). The `refreshing` latch prevents a reload loop.
    if (navigator.serviceWorker.controller) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        // Force an update check on every mount so a deploy that landed while
        // the PWA was backgrounded is detected on the next launch instead of
        // waiting for the browser's periodic (~24h) sw.js poll.
        registration.update().catch(() => {});
        // No auto-prompt. If the user has already granted permission on a
        // previous visit, the existing subscription is silently re-POSTed
        // so the server row stays fresh after a wipe / re-login. Default
        // and denied states do nothing here — opt-in flows through the
        // settings page button.
        if (
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          const sub = await registration.pushManager.getSubscription();
          if (sub) {
            void fetch("/api/push/subscribe", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...sub.toJSON(),
                userAgent: navigator.userAgent,
              }),
            }).catch(() => {
              // Non-fatal — next opt-in / settings visit will retry.
            });
          }
        }
      } catch (err) {
        console.error("[sw-register]", err);
      }
    })();
  }, []);
  return null;
}
