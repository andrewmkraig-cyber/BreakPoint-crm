// Ace PWA service worker. Bump CACHE_NAME on any logic change so
// the activate handler purges the previous shell.
const CACHE_NAME = "ace-shell-v1";
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
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
      tag: data.tag,
    }),
  );
});

// Click handler: focus the first existing Ace window if one is open
// (so we don't pile up tabs), otherwise open a fresh one. The window
// is navigated to the payload's url so the click deep-links to the
// thread / call that triggered the notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) =>
        c.url.includes(self.location.origin),
      );
      if (existing) {
        existing.focus();
        existing.navigate(url);
        return;
      }
      return self.clients.openWindow(url);
    }),
  );
});
