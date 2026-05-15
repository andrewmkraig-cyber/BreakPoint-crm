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
  // Captures any failure that lands after permission was granted (VAPID
  // env missing, /api/push/subscribe non-2xx, pushManager.subscribe
  // throws). Without this, status="granted" wins the render branch and
  // the UI lies that everything succeeded — the recruiter has no way
  // back to a Try-again affordance from that copy.
  const [errored, setErrored] = useState(false);
  // Tracks whether the *server* has a live subscription row for this
  // browser. Browser permission can be "granted" while the server has
  // no row (the user clicked Disable, or never finished enabling).
  // Drives the granted-state copy: "Enabled" + Disable when a row
  // exists, "Enable notifications" otherwise.
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as Status);
    // If permission is already granted on this device, check whether a
    // pushManager subscription still exists — that's the closest
    // browser-side signal that the server has a row.
    if (Notification.permission === "granted") {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setHasSubscription(!!sub))
        .catch(() => setHasSubscription(false));
    }
  }, []);

  async function enable() {
    setBusy(true);
    setErrored(false);
    let succeeded = false;
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
        setErrored(true);
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
        setErrored(true);
        return;
      }
      toast.success("Notifications enabled.");
      setHasSubscription(true);
      succeeded = true;
    } catch (err) {
      console.error("[push] enable failed", err);
      toast.error("Couldn't enable notifications.");
      setErrored(true);
    } finally {
      setBusy(false);
      if (succeeded) setErrored(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first so we delete the row even if the
        // browser-side unsubscribe fails / hangs. Endpoint scopes the
        // delete to the caller's userId so it's a safe no-op when the
        // row's already gone.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }
      setHasSubscription(false);
      toast.success("Notifications disabled on this device.");
    } catch (err) {
      console.error("[push] disable failed", err);
      toast.error("Couldn't disable notifications.");
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

  // Error branch wins over status="granted" — without this, a failed
  // /api/push/subscribe call would leave the UI claiming success
  // because the browser permission did flip to granted.
  if (errored) {
    return (
      <div className="space-y-1.5">
        <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </Button>
        <p className="text-xs text-court-fg-muted">
          Check browser settings if this persists.
        </p>
      </div>
    );
  }

  if (status === "granted" && hasSubscription) {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-court-accent-tint px-2 py-1 text-xs font-semibold text-court-accent-dark">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-court-accent"
          />
          Enabled
        </span>
        <Button variant="secondary" size="sm" onClick={disable} disabled={busy}>
          {busy ? "Disabling…" : "Disable"}
        </Button>
      </div>
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

  // Either status === "default" OR status === "granted" but the server
  // has no live subscription (user disabled, or never finished
  // enabling). Both surface the same Enable affordance.
  return (
    <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
      {busy ? "Enabling…" : "Enable notifications"}
    </Button>
  );
}
