"use client";
import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
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
