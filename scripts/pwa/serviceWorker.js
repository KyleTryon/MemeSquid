/* global CACHE_NAME, PRECACHE_ASSETS */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(
        PRECACHE_ASSETS.map(
          (asset) => new Request(new URL(asset, self.registration.scope), { cache: 'reload' }),
        ),
      );
      // Let existing editor tabs finish before activating a new build.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('memesquid-app-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME).catch(() => null);
      // Serve one complete build, including on reload while an update is waiting.
      const cacheKey =
        request.mode === 'navigate' ? new URL('./index.html', self.registration.scope) : request;
      // These same-origin static files do not vary with module-request Origin headers.
      const cachedResponse = await cache?.match(cacheKey, { ignoreVary: true });
      if (cachedResponse) return cachedResponse;

      const response = await fetch(request);
      if (cache && response.ok) {
        try {
          await cache.put(request, response.clone());
        } catch {
          // A quota or storage error must not discard a successful network response.
        }
      }
      return response;
    })(),
  );
});
