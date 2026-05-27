"use client";

const PUSH_DEVICE_INTENT_KEY = "ace_push_device_intent_v1";

type PushDeviceIntent = "enabled" | "disabled";

type PushSyncResult = {
  subscription: PushSubscription | null;
  repaired: boolean;
};

let grantedSyncInFlight: Promise<PushSyncResult> | null = null;

function readPushDeviceIntent(): PushDeviceIntent | null {
  try {
    const raw = window.localStorage.getItem(PUSH_DEVICE_INTENT_KEY);
    return raw === "enabled" || raw === "disabled" ? raw : null;
  } catch {
    return null;
  }
}

export function writePushDeviceIntent(intent: PushDeviceIntent) {
  try {
    window.localStorage.setItem(PUSH_DEVICE_INTENT_KEY, intent);
  } catch {
    // Storage is best-effort; browser permission/subscription still
    // remains the source of truth for this session.
  }
}

// URL-base64 -> Uint8Array. Web Push wants applicationServerKey as a byte
// array, while the VAPID public key is exposed as URL-safe base64.
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

function getApplicationServerKey(): BufferSource | null {
  const vapidKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
    .trim()
    .replace(/^"|"$/g, "");
  if (!vapidKey) return null;
  return urlBase64ToUint8Array(vapidKey) as unknown as BufferSource;
}

export async function postPushSubscription(subscription: PushSubscription) {
  return fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  });
}

export function subscribeToPush(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const applicationServerKey = getApplicationServerKey();
  if (!applicationServerKey) {
    return Promise.reject(new Error("VAPID public key missing"));
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}

export async function syncGrantedPushSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSyncResult> {
  if (grantedSyncInFlight) return grantedSyncInFlight;
  grantedSyncInFlight = syncGrantedPushSubscriptionOnce(registration).finally(
    () => {
      grantedSyncInFlight = null;
    },
  );
  return grantedSyncInFlight;
}

async function syncGrantedPushSubscriptionOnce(
  registration: ServiceWorkerRegistration,
): Promise<PushSyncResult> {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return { subscription: null, repaired: false };
  }

  const intent = readPushDeviceIntent();
  const existing = await registration.pushManager.getSubscription();

  if (intent === "disabled") {
    if (existing) await existing.unsubscribe().catch(() => {});
    return { subscription: null, repaired: false };
  }

  if (existing) {
    const res = await postPushSubscription(existing);
    if (!res.ok) throw new Error(`/api/push/subscribe ${res.status}`);
    writePushDeviceIntent("enabled");
    return { subscription: existing, repaired: false };
  }

  // Permission is already granted, so recreating a missing subscription does
  // not need to show a browser prompt. This repairs iOS PWA subscription
  // expiry after long idle/app close without making Andrew toggle again.
  const repaired = await subscribeToPush(registration);
  const res = await postPushSubscription(repaired);
  if (!res.ok) throw new Error(`/api/push/subscribe ${res.status}`);
  writePushDeviceIntent("enabled");
  return { subscription: repaired, repaired: true };
}
