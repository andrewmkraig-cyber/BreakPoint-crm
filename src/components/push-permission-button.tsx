"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Permission status drives copy and which action runs on click. We don't
// auto-prompt anywhere — opting in is always explicit (a tap on this
// button), which matches Chrome's UX rules (auto-prompts get throttled).
type Status = "loading" | "unsupported" | "default" | "granted" | "denied";

// URL-base64 → Uint8Array. Web Push wants applicationServerKey as a
// byte array; the VAPID public key we expose is the URL-safe base64
// string (RFC 4648 §5: `-` and `_` instead of `+` and `/`, no padding).
// Standard atob() only accepts canonical base64, so we re-pad and
// flip the URL-safe chars back before decoding.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushPermissionButton({
  onStatusChange,
  hideStatusPill = false,
}: {
  // Fires whenever the live state (browser-granted AND server-
  // subscribed) settles, so a parent Connectors row can mirror it in
  // its own StateLabel without re-running the getSubscription probe.
  onStatusChange?: (connected: boolean) => void;
  // When embedded in a row that already shows a CONNECTED label, the
  // green "Enabled on this device" pill is redundant - render only the
  // Disable control.
  hideStatusPill?: boolean;
} = {}) {
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
  // Pre-resolved service worker registration. iOS Safari requires
  // pushManager.subscribe() to be called inside the same task as the
  // user-gesture event (a tap). Awaiting navigator.serviceWorker.ready
  // inside the click handler breaks that gesture chain — by the time
  // the await resolves, the gesture flag is gone and Safari rejects
  // the subscribe with a generic NotAllowedError. Caching the reg on
  // mount means the click handler can call subscribe() synchronously.
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  // Keep the latest callback in a ref so the mount effect can notify the
  // parent without taking onStatusChange as a dep - an inline parent
  // function would otherwise re-run the SW registration probe each render.
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as Status);
    navigator.serviceWorker.ready
      .then((reg) => {
        registrationRef.current = reg;
        // Backfill: if permission is already granted on this device,
        // check whether a live subscription exists so the granted
        // branch renders "Enabled + Disable" rather than the Enable
        // button again.
        if (Notification.permission === "granted") {
          return reg.pushManager.getSubscription();
        }
        return null;
      })
      .then((sub) => {
        setHasSubscription(!!sub);
        onStatusChangeRef.current?.(
          Notification.permission === "granted" && !!sub,
        );
      })
      .catch(() => {
        setHasSubscription(false);
        onStatusChangeRef.current?.(false);
      });
  }, []);

  // CRITICAL: this handler is intentionally NOT async. iOS Safari for
  // installed PWAs requires pushManager.subscribe() to be invoked
  // inside the same task as the user-gesture event. async/await would
  // push everything past the click into a microtask continuation
  // where the gesture flag is gone. The promise chain below runs
  // after subscribe(), which is fine — subscribe() itself is what
  // needs the gesture, and we call it synchronously.
  function enable() {
    setBusy(true);
    setErrored(false);
    // Trim aggressively. The InvalidCharacterError that this codepath
    // used to throw was almost always a Vercel env var with a trailing
    // newline or wrapping quotes — atob() chokes on whitespace and on
    // `"`, neither of which are base64 chars. Stripping them up front
    // is cheaper than chasing it down in Vercel UI each redeploy.
    const vapidKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
      .trim()
      .replace(/^"|"$/g, "");
    const reg = registrationRef.current;
    if (!vapidKey) {
      toast.error("VAPID public key missing. Push not configured.");
      setErrored(true);
      setBusy(false);
      return;
    }
    if (!reg) {
      // useEffect populates this within a few ms of mount; landing
      // here usually means the user tapped before the SW finished
      // installing. Surface a soft retry — they can tap again.
      toast.error("Service worker still installing. Try again in a moment.");
      setBusy(false);
      return;
    }
    // subscribe() with userVisibleOnly:true triggers the OS permission
    // prompt internally when Notification.permission === "default",
    // so we don't call Notification.requestPermission() separately.
    // That collapsed flow is what Safari's user-gesture check wants:
    // one synchronous call from the click → permission prompt → push
    // subscription, all in one promise chain.
    reg.pushManager
      .subscribe({
        userVisibleOnly: true,
        // Cast: DOM lib types want Uint8Array<ArrayBuffer> here but
        // our helper returns Uint8Array<ArrayBufferLike>. The runtime
        // value is identical; the lib types just narrowed too tightly.
        applicationServerKey: urlBase64ToUint8Array(
          vapidKey,
        ) as unknown as BufferSource,
      })
      .then((subscription) =>
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...subscription.toJSON(),
            userAgent: navigator.userAgent,
          }),
        }).then((res) => {
          if (!res.ok) {
            throw new Error(`/api/push/subscribe ${res.status}`);
          }
          setStatus("granted");
          setHasSubscription(true);
          onStatusChangeRef.current?.(true);
          toast.success("Notifications enabled.");
          // Re-read permission state explicitly so the console log
          // surfaces what the browser settled on after subscribe()
          // (subscribe handled the prompt internally). On macOS this
          // call is also a redundant "register intent" signal that
          // can nudge the OS into surfacing Ace in System Settings →
          // Notifications immediately rather than after a restart.
          void Notification.requestPermission().then((permission) => {
            console.log("[push] notification permission:", permission);
          });
        }),
      )
      .catch((err) => {
        console.error("[push] enable failed", err);
        onStatusChangeRef.current?.(false);
        // Re-read permission state here — subscribe()'s internal
        // permission prompt may have flipped it to denied, in which
        // case the user needs the browser-settings nudge rather than
        // a generic retry button.
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "denied"
        ) {
          setStatus("denied");
          toast.error(
            "Notifications blocked. Enable them in browser settings.",
          );
        } else {
          setErrored(true);
          toast.error("Couldn't enable notifications.");
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = registrationRef.current ?? (await navigator.serviceWorker.ready);
      const subscription = await reg.pushManager.getSubscription();
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
      onStatusChangeRef.current?.(false);
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
        <p className="text-sm font-medium text-court-fg">
          Couldn&apos;t enable notifications
        </p>
        <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </Button>
        <p className="text-xs text-court-fg-muted">
          Check browser notification settings if this persists.
        </p>
      </div>
    );
  }

  if (status === "granted" && hasSubscription) {
    return (
      <div className="flex items-center gap-3">
        {!hideStatusPill && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-court-accent-tint px-2 py-1 text-xs font-semibold text-court-accent-dark">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Enabled on this device
          </span>
        )}
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
    <Button variant="secondary" size="sm" onClick={enable} disabled={busy}>
      {busy ? "Enabling…" : "Enable notifications"}
    </Button>
  );
}
