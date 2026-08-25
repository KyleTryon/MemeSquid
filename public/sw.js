const CACHE_NAME = 'memesquid-app-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const cacheBuiltAssets = async (cache) => {
  const indexUrl = new URL('./index.html', self.registration.scope);
  const response = await fetch(indexUrl, { cache: 'reload' });

  if (!response.ok) {
    throw new Error(`Unable to cache app shell: ${response.status}`);
  }

  const html = await response.clone().text();
  const builtAssetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], indexUrl))
    .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/'));

  await cache.put(indexUrl, response);
  await Promise.all(
    builtAssetUrls.map(async (url) => {
      const assetResponse = await fetch(url, { cache: 'reload' });
      if (assetResponse.ok) await cache.put(url, assetResponse);
    }),
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await cacheBuiltAssets(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('memesquid-app-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (
            (await caches.match(request)) ||
            (await caches.match(new URL('./index.html', self.registration.scope))) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) return cachedResponse;

      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
