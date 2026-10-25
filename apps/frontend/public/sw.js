/*
 * Nexus service worker (P-8).
 *
 * Scope is deliberately small: cache the app shell and cached speech so the
 * review screen opens offline, and leave data requests to the app, which keeps
 * its own due-card cache and offline review queue. Vite dev-server internals
 * are never cached, so editing the app cannot serve stale modules.
 */
const VERSION = 'v1';
const SHELL_CACHE = `nexus-shell-${VERSION}`;
const RUNTIME_CACHE = `nexus-runtime-${VERSION}`;
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Cache-first with a background refresh, used for immutable-ish assets. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

/** Cache-first, used for content-addressed speech clips. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cached read-aloud clips (owner-scoped, content-addressed) so replay works
  // offline. Everything else under /api and all tRPC traffic stays live.
  if (url.pathname.startsWith('/api/audio/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/trpc/') ||
    url.pathname.startsWith('/ws')
  ) {
    return;
  }

  // Never intercept the dev server's module graph or HMR endpoints.
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (
          (await cache.match('/index.html')) ??
          (await cache.match('/')) ??
          new Response('Offline', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          })
        );
      }),
    );
    return;
  }

  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
