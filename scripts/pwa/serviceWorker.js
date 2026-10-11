/* global CACHE_NAME, PRECACHE_ASSETS */

const assetUrls = new Set(
  PRECACHE_ASSETS.map((asset) => new URL(asset, self.registration.scope).href),
);
const assetDirectory = new URL('./assets/', self.registration.scope).href;
const shellUrls = new Set([
  self.registration.scope,
  new URL('./index.html', self.registration.scope).href,
]);
const currentBuildClients = new Set();
let previousCacheNames = [];
let cleanupInProgress = null;

function isValidAsset(url, response) {
  if (!response?.ok) return false;
  const pathname = new URL(url).pathname;
  const contentType = response.headers.get('content-type')?.split(';')[0].trim();
  if (pathname.endsWith('.js'))
    return contentType === 'text/javascript' || contentType === 'application/javascript';
  if (pathname.endsWith('.css')) return contentType === 'text/css';
  if (pathname.endsWith('.wasm')) return contentType === 'application/wasm';
  return contentType !== 'text/html' || shellUrls.has(url);
}

async function cleanUnusedBuilds() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Unknown clients may still be running an older editor, including after a worker restart.
  if (
    clients.some(
      (client) =>
        client.url.startsWith(self.registration.scope) && !currentBuildClients.has(client.id),
    )
  )
    return;

  await Promise.all(previousCacheNames.map((name) => caches.delete(name)));
  previousCacheNames = [];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll([...assetUrls].map((url) => new Request(url, { cache: 'reload' })));
        // SPA hosts can return index.html with status 200 for a missing JavaScript chunk.
        for (const url of assetUrls) {
          const response = await cache.match(url, { ignoreVary: true });
          if (!isValidAsset(url, response)) throw new Error(`Invalid offline asset: ${url}`);
        }
      } catch (error) {
        await caches.delete(CACHE_NAME);
        throw error;
      }
      // A broken old tab must not prevent a complete new build from taking over.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Only retire predecessors, never a newer build being installed in the background.
      previousCacheNames = (await caches.keys().catch(() => [])).filter(
        (name) => name.startsWith('memesquid-app-') && name !== CACHE_NAME,
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate';
  const builtAsset = request.url.startsWith(assetDirectory);
  if (!navigation && !assetUrls.has(request.url) && !builtAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME).catch(() => null);
      const cacheKey = navigation
        ? new URL('./index.html', self.registration.scope).href
        : request.url;
      // Cache failures must not turn a working network connection into a blank page.
      const cachedResponse = await cache?.match(cacheKey, { ignoreVary: true }).catch(() => null);
      if (isValidAsset(cacheKey, cachedResponse)) {
        if (navigation && event.resultingClientId) currentBuildClients.add(event.resultingClientId);
        // Hosts may redirect index.html to /. Navigations reject redirected responses.
        if (navigation && cachedResponse.redirected) {
          return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: cachedResponse.headers,
          });
        }
        return cachedResponse;
      }

      // Content-hashed URLs identify an exact asset, so old editor tabs can finish safely.
      if (builtAsset) {
        const cacheNames = await caches.keys().catch(() => []);
        for (const name of cacheNames) {
          if (!name.startsWith('memesquid-app-') || name === CACHE_NAME) continue;
          const oldCache = await caches.open(name).catch(() => null);
          const response = await oldCache?.match(request, { ignoreVary: true }).catch(() => null);
          if (isValidAsset(request.url, response)) return response;
        }
      }

      const response = await fetch(request);
      // Never overwrite a build's HTML with a newer deployment's entry point.
      if (cache && !navigation && isValidAsset(request.url, response)) {
        try {
          await cache.put(request, response.clone());
        } catch {
          // A quota or storage error must not discard a successful network response.
        }
      }
      return response;
    })(),
  );

  if (
    previousCacheNames.length &&
    event.clientId &&
    currentBuildClients.has(event.clientId) &&
    !cleanupInProgress
  ) {
    cleanupInProgress = cleanUnusedBuilds()
      .catch(() => {
        // Cache cleanup is optional; keep serving the editor if storage is unavailable.
      })
      .finally(() => {
        cleanupInProgress = null;
      });
    event.waitUntil(cleanupInProgress);
  }
});
