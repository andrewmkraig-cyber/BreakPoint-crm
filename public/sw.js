// Ace PWA service worker. Bump CACHE_NAME on any logic change so
// the activate handler purges the previous shell.
const CACHE_NAME = "ace-shell-v3";
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

// Push handler. Payload shape comes from sendPushToUser /
// sendPushToOrg in src/lib/web-push.ts — always JSON with at least
// title + body, optionally url and tag. Tag dedupes: subsequent
// pushes with the same tag replace the previous notification rather
// than stacking (e.g. 5 texts in one thread => one notification).
//
// Visibility short-circuit: if any same-origin Ace window is open AND
// currently visible, suppress the system notification — the in-app
// toast (mail-context, reminder-toast-provider, etc.) already fired
// on that surface and a duplicate OS notification would just be
// noise. includeUncontrolled covers windows that opened before this
// SW activated.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const aceOpen = clients.some(
          (c) =>
            c.url.includes(self.location.origin) &&
            c.visibilityState === "visible",
        );
        if (!aceOpen) {
          await self.registration.showNotification(data.title, {
            body: data.body,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: { url: data.url || "/" },
            tag: data.tag,
          });
        }
        // Update badge count via badging API if supported. When Ace is
        // closed there's no client to call setAppBadge, so the SW does
        // it from here — otherwise the home-screen dot only appears
        // after the user opens Ace and the 30s poll fires.
        //
        // Payload contract (see src/lib/web-push.ts + unread-counts.ts):
        //   badgeCount > 0  → setAppBadge(N): real count, badge stacks
        //                     correctly as more pushes arrive.
        //   badgeCount === 0 → clearAppBadge(): sender explicitly says
        //                     "nothing left to read."
        //   badgeCount null / missing → leave the badge ALONE. Means
        //                     the sender couldn't compute the total
        //                     (e.g. Gmail unreachable when a text push
        //                     fires) — clobbering with a partial count
        //                     would regress an already-correct badge.
        //
        // Awaited inside the outer waitUntil so the SW isn't killed
        // before the badge promise resolves (iOS Safari especially is
        // quick to kill SW work that escapes waitUntil).
        if ("setAppBadge" in self.navigator) {
          const n = data.badgeCount;
          if (typeof n === "number" && n > 0) {
            await self.navigator.setAppBadge(n).catch(() => {});
          } else if (n === 0) {
            await self.navigator.clearAppBadge?.().catch(() => {});
          }
        }
        // Also tell any open Ace windows (even backgrounded ones) to
        // refresh their unread counts immediately instead of waiting
        // for the next 30s poll.
        const windows = await self.clients.matchAll({ type: "window" });
        windows.forEach((client) => {
          client.postMessage({ type: "PUSH_RECEIVED" });
        });
      }),
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
// unread total is 0. Same goes for notificationclose — banner auto-
// dismiss used to clear the badge here, which caused the flash-and-
// disappear bug, so the close handler is gone entirely.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(async (clients) => {
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
        return;
      }
      // No window open — opening one mounts MailProvider + PhoneProvider
      // which auto-poll and reconcile the badge on their own.
      await self.clients.openWindow(url);
    }),
  );
});
