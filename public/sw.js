// Ace PWA service worker. Bump CACHE_NAME on any logic change so
// the activate handler purges the previous shell.
const CACHE_NAME = "ace-shell-v13";
const PRECACHE_URLS = ["/", "/offline"];

self.addEventListener("install", (event) => {
  // _next/static/ assets are content-hashed and only known at build
  // time, so we can't enumerate them here. They're picked up lazily
  // by the cache-first branch of the fetch handler on first request.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // Best-effort badge self-heal on SW cold-start. iOS can suspend the
      // worker and evict the app-icon badge while Ace sits idle; on the
      // next wake (activate) re-assert it from the live server unread
      // total so a stale or missing badge converges without waiting for
      // the app to be foregrounded. Failures are swallowed inside the
      // helpers - the open-app context polls remain the authoritative
      // reconciler, this is purely additive.
      const total = await fetchUnreadTotal();
      if (total !== null) await applyBadge(total);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/");
  const isApi = url.pathname.startsWith("/api/");
  const isNavigate = request.mode === "navigate";

  if (isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isApi) {
    event.respondWith(networkFirst(request, { fallback: null }));
    return;
  }
  if (isNavigate) {
    event.respondWith(networkFirst(request, { fallback: "/offline" }));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, { fallback }) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && request.mode === "navigate") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallback) {
      const fb = await cache.match(fallback);
      if (fb) return fb;
    }
    throw err;
  }
}

// --- Badge self-heal helpers ------------------------------------------
// Shared by the activate handler (cold-start re-assert) and the push
// handler (fallback when a push carries no numeric badgeCount).

// Pull the combined mail + phone unread total from the same authed
// endpoints the in-app contexts poll (/api/mail/unread +
// /api/phone/unread-count, both returning { count }). A service-worker
// fetch sends the same-origin session cookie, so these resolve as the
// logged-in recruiter. Returns the total, or null when NEITHER count
// could be read - so callers leave the badge alone instead of zeroing a
// known-good number on a transient auth / network blip. A single null
// side counts as 0 (mirrors the in-app MailTabTitleSync math).
async function fetchUnreadTotal() {
  const read = async (url) => {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return typeof body?.count === "number" ? body.count : null;
    } catch {
      return null;
    }
  };
  const [mail, phone] = await Promise.all([
    read("/api/mail/unread"),
    read("/api/phone/unread-count"),
  ]);
  if (mail === null && phone === null) return null;
  return (mail ?? 0) + (phone ?? 0);
}

// Apply a resolved total to the app icon: a positive number sets the
// badge, zero clears it. Guarded on Badging API support; all failures
// swallowed (iOS rejects when the page isn't installed / visible).
async function applyBadge(total) {
  if (!("setAppBadge" in self.navigator)) return;
  if (total > 0) {
    await self.navigator.setAppBadge(total).catch(() => {});
  } else {
    await self.navigator.clearAppBadge?.().catch(() => {});
  }
}

async function closeNotificationsByTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return;
  const wanted = new Set(tags.filter((t) => typeof t === "string" && t));
  if (wanted.size === 0) return;
  const notes = await self.registration.getNotifications();
  for (const n of notes) {
    if (wanted.has(n.tag)) n.close();
  }
}

function normalizePushData(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const fallbackBody = typeof raw === "string" && raw.trim()
    ? raw.trim()
    : "Ace has a new update.";
  const title = typeof data.title === "string" && data.title.trim()
    ? data.title.trim()
    : "Ace";
  const body = typeof data.body === "string" && data.body.trim()
    ? data.body
    : fallbackBody;
  return {
    ...data,
    title,
    body,
    url: typeof data.url === "string" && data.url ? data.url : "/",
    tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
  };
}

function readPushData(event) {
  if (!event.data) return normalizePushData(null);
  try {
    const text = event.data.text();
    if (!text) return normalizePushData(null);
    try {
      return normalizePushData(JSON.parse(text));
    } catch {
      return normalizePushData(text);
    }
  } catch {
    return normalizePushData(null);
  }
}

// Push handler. Payload shape comes from sendPushToUser /
// sendPushToOrg in src/lib/web-push.ts - normally JSON with at least
// title + body, optionally url and tag. Tag dedupes: subsequent pushes
// with the same tag replace the previous notification rather than
// stacking (e.g. 5 texts in one thread => one notification).
//
// iOS/WebKit contract: every push event must result in a user-visible
// notification. Do not suppress while Ace is focused, and do not return
// early for missing / malformed data. Silent push handling can cause iOS
// to drop or revoke the PushSubscription, which looks exactly like
// "notifications and badges only update after opening the app".
self.addEventListener("push", (event) => {
  const data = readPushData(event);
  event.waitUntil(
    (async () => {
      await closeNotificationsByTags(data.closeTags).catch(() => {});
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: data.url },
        // Per-thread tag (sms-<id> / gmail-push) so a burst in one
        // thread replaces its own banner instead of stacking, while
        // different threads still surface separately. renotify re-alerts
        // (sound/vibrate) when a replacement lands so a follow-up text
        // isn't silently swapped in.
        ...(data.tag ? { tag: data.tag, renotify: true } : {}),
      });

      // Update badge count via badging API if supported. When Ace is
      // closed there's no client to call setAppBadge, so the SW does
      // it from here - otherwise the home-screen badge only appears
      // after the user opens Ace and the poll fires.
      //
      // Payload contract (see src/lib/web-push.ts + unread-counts.ts):
      // every mail/SMS/call push now carries a NUMERIC badgeCount
      // equal to unread email threads + unread SMS conversations, so
      // the common path is a straight setAppBadge(N):
      //   badgeCount > 0  -> setAppBadge(N): the true combined total.
      //   badgeCount === 0 -> clearAppBadge(): nothing left to read.
      //   badgeCount null / missing -> fetch the live combined unread
      //                     total from the server and set the badge
      //                     from that; only if THAT fetch also fails do
      //                     we leave the badge alone (the original
      //                     last-resort behavior). Legacy pushes that
      //                     predate the numeric contract, and the Quo
      //                     SMS/call pushes that omit the count when it
      //                     is unreliable, land here - and after a long
      //                     idle a stale badge is worse than a re-derived
      //                     one, so we self-heal rather than no-op.
      //
      // Awaited inside the outer waitUntil so the SW isn't killed
      // before the badge promise resolves (iOS Safari especially is
      // quick to kill SW work that escapes waitUntil).
      if ("setAppBadge" in self.navigator) {
        const n = data.badgeCount;
        if (typeof n === "number") {
          await applyBadge(n);
        } else {
          const total = await fetchUnreadTotal();
          if (total !== null) await applyBadge(total);
        }
      }
      // Also tell any open Ace windows (even backgrounded ones) to
      // refresh their unread counts immediately instead of waiting
      // for the next 30s poll.
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((client) => {
        client.postMessage({ type: "PUSH_RECEIVED" });
      });
    })(),
  );
});

// Click handler: focus the first existing Ace window if one is open
// (so we don't pile up tabs), otherwise open a fresh one. The window
// is navigated to the payload's url so the click deep-links to the
// thread / call that triggered the notification.
//
// Badge policy: do NOT clear here. A tap acknowledges one notification
// but other unread mail/text may still exist. Once Ace is focused or
// opened, the PUSH_RECEIVED postMessage triggers mail-tab-title-sync's
// real-count reconciliation, which clears the badge only if the true
// unread total is 0. Same goes for notificationclose - banner auto-
// dismiss used to clear the badge here, which caused the flash-and-
// disappear bug, so the close handler is gone entirely.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      const existing = clients.find((c) =>
        c.url.includes(self.location.origin),
      );
      if (existing) {
        existing.focus();
        existing.navigate(url);
        // Nudge mail-tab-title-sync to re-poll immediately so the
        // badge converges on the true unread total within seconds of
        // the tap instead of waiting for the next 15s/30s tick.
        existing.postMessage({ type: "PUSH_RECEIVED" });
      } else {
        // No window open - opening one mounts MailProvider + PhoneProvider
        // which auto-poll and reconcile the badge on their own.
        await self.clients.openWindow(url);
      }
      // Dismiss any other Ace banners still sitting in the OS tray so the
      // stack doesn't re-surface as the app gains focus. This closes
      // notification banners ONLY - it deliberately does NOT touch the app
      // badge, which still reconciles to the true unread total via the
      // PUSH_RECEIVED message above (keeps the badge policy in the header
      // comment intact).
      const notes = await self.registration.getNotifications();
      for (const n of notes) n.close();
    })(),
  );
});

// Push subscription rotation / expiry. The browser fires this when it
// invalidates the existing push subscription - common on iOS after the
// PWA sits idle for a long stretch. Without re-subscribing here the
// server's stored PushSubscription row goes stale, push delivery stops,
// and with it the ONLY closed-app badge writer dies silently until the
// user re-opens Ace and re-enables in Settings. This is the most
// important leg of the self-heal: it keeps push alive across long idle.
//
// Prefer the SAME VAPID key the old subscription was created with
// (event.oldSubscription.options.applicationServerKey). Some browsers,
// notably on iOS, may fire this event without an oldSubscription/key; in
// that case fetch the public VAPID key from Ace and recreate the
// subscription anyway. Some browsers hand us the already-rotated
// subscription on event.newSubscription - if so we just re-POST that.
// Either way the new subscription is upserted via the same
// /api/push/subscribe endpoint + body shape sw-register uses, so the
// server row stays fresh (upsert is keyed on endpoint).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let subscription = event.newSubscription || null;
      if (!subscription) {
        const applicationServerKey = await getApplicationServerKey(
          event.oldSubscription,
        );
        if (!applicationServerKey) return;
        subscription = await self.registration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey })
          .catch(() => null);
      }
      if (!subscription) return;
      // Same-origin fetch carries the session cookie so the server binds
      // the row to the logged-in recruiter. If the session has lapsed the
      // POST 401s and we drop it - the browser-side subscription still
      // exists and sw-register re-POSTs it on the next app open.
      await fetch("/api/push/subscribe", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...subscription.toJSON(),
          userAgent: self.navigator.userAgent,
        }),
      }).catch(() => {});
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getApplicationServerKey(oldSubscription) {
  const oldKey = oldSubscription?.options?.applicationServerKey;
  if (oldKey) return oldKey;
  try {
    const res = await fetch("/api/push/vapid-public-key", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return typeof body?.key === "string" && body.key.trim()
      ? urlBase64ToUint8Array(body.key.trim())
      : null;
  } catch {
    return null;
  }
}
