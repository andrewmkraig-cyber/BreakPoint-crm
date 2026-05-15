"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Permission status drives copy and which action runs on click. We don't
// auto-prompt anywhere — opting in is always explicit (a tap on this
// button), which matches Chrome's UX rules (auto-prompts get throttled).
type Status = "loading" | "unsupported" | "default" | "granted" | "denied";

// URL-base64 → Uint8Array. Web Push wants applicationServerKey as a
// byte array; the VAPID public key we expose is the URL-safe base64
// string. Padded back to a 4-multiple before decode.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushPermissionButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as Status);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setStatus(permission as Status);
      if (permission !== "granted") {
        toast.error(
          permission === "denied"
            ? "Notifications blocked — enable them in browser settings."
            : "Notifications not enabled.",
        );
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        toast.error("VAPID public key missing — push not configured.");
        return;
      }
      // Reuse an existing subscription when present — the browser
      // hands back the same object, the server upsert collapses it
      // onto the existing row.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: DOM lib types want Uint8Array<ArrayBuffer> here but
          // our helper returns Uint8Array<ArrayBufferLike>. The runtime
          // value is identical; the lib types just narrowed too tightly.
          applicationServerKey: urlBase64ToUint8Array(
            vapidKey,
          ) as unknown as BufferSource,
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...subscription.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) {
        toast.error("Couldn't register notifications — try again later.");
        return;
      }
      toast.success("Notifications enabled.");
    } catch (err) {
      console.error("[push] enable failed", err);
      toast.error("Couldn't enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") return null;

  if (status === "unsupported") {
    return (
      <p className="text-xs text-court-fg-muted">
        This browser doesn&apos;t support web push notifications.
      </p>
    );
  }

  if (status === "granted") {
    return (
      <p className="text-xs text-court-fg-muted">
        Notifications are enabled on this device.
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p className="text-xs text-court-fg-muted">
        Notifications are blocked. Re-enable them in your browser settings, then
        reload.
      </p>
    );
  }

  return (
    <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
      {busy ? "Enabling…" : "Enable notifications"}
    </Button>
  );
}
