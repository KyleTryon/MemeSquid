import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildServiceWorker } from './buildServiceWorker';

const scope = 'https://example.com/editor/';
const assets = [
  { fileName: 'index.html', source: '<html>editor v1</html>' },
  { fileName: 'assets/editor.js', source: 'editor v1' },
  { fileName: 'assets/svg.js', source: 'SVG renderer' },
  { fileName: 'assets/templates.js', source: 'template library' },
  { fileName: 'assets/template.webp', source: 'template image' },
  { fileName: 'assets/inference.wasm', source: 'large WASM runtime' },
];

type CacheKey = Pick<Request, 'url' | 'headers'> | URL | string;
interface WorkerEvent {
  clientId?: string;
  resultingClientId?: string;
  request?: Pick<Request, 'url' | 'method' | 'mode' | 'headers'>;
  waitUntil: (work: Promise<void>) => void;
  respondWith: (response: Promise<Response>) => void;
}

function createWorker(source = buildServiceWorker(assets)) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const requests: string[] = [];
  const cachedHeaders = new Map<string, Headers>();
  const keyOf = (key: CacheKey) =>
    typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
  const headersOf = (key: CacheKey) =>
    typeof key === 'object' && 'headers' in key ? key.headers : new Headers();
  let offline = false;
  let failWrites = false;
  let failReads = false;
  let failOpens = false;
  let failedUrl: string | null = null;
  let htmlUrl: string | null = null;
  let claims = 0;
  let skips = 0;
  let clients: { id: string; url: string }[] = [];
  const fetchResource = (key: CacheKey): Promise<Response> => {
    const url = keyOf(key);
    requests.push(url);
    if (offline) return Promise.reject(new Error('Offline'));
    if (url === failedUrl) return Promise.resolve(new Response('Missing', { status: 404 }));
    if (url === htmlUrl)
      return Promise.resolve(
        new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
      );
    const asset = assets.find((entry) => new URL(entry.fileName, scope).href === url);
    const extension = new URL(url).pathname.split('.').at(-1);
    const contentType =
      extension === 'js'
        ? 'text/javascript'
        : extension === 'css'
          ? 'text/css'
          : extension === 'wasm'
            ? 'application/wasm'
            : extension === 'html'
              ? 'text/html'
              : 'image/webp';
    return Promise.resolve(
      new Response(asset?.source ?? 'Network response', {
        headers: { Vary: 'Origin', 'Content-Type': contentType },
      }),
    );
  };

  runInNewContext(source, {
    Request,
    Response,
    URL,
    fetch: fetchResource,
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      skipWaiting() {
        skips += 1;
        return Promise.resolve();
      },
      clients: {
        matchAll: () => Promise.resolve(clients),
        claim() {
          claims += 1;
          return Promise.resolve();
        },
      },
      addEventListener(name: string, handler: (event: WorkerEvent) => void) {
        handlers.set(name, handler);
      },
    },
    caches: {
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
      open(name: string) {
        if (failOpens) return Promise.reject(new Error('Storage unavailable'));
        let store = stores.get(name);
        if (!store) {
          store = new Map<string, Response>();
          stores.set(name, store);
        }
        const cache = store;
        return Promise.resolve({
          match: (key: CacheKey, options?: CacheQueryOptions) => {
            if (failReads) return Promise.reject(new Error('Cache read failed'));
            const response = cache.get(keyOf(key));
            const originalHeaders = cachedHeaders.get(`${name}:${keyOf(key)}`);
            const vary = response?.headers.get('vary')?.split(',') ?? [];
            if (
              !options?.ignoreVary &&
              vary.some(
                (header) =>
                  originalHeaders?.get(header.trim()) !== headersOf(key).get(header.trim()),
              )
            )
              return Promise.resolve(undefined);
            return Promise.resolve(response?.clone());
          },
          put(key: CacheKey, response: Response) {
            if (failWrites) return Promise.reject(new Error('Storage quota exceeded'));
            cache.set(keyOf(key), response);
            cachedHeaders.set(`${name}:${keyOf(key)}`, headersOf(key));
            return Promise.resolve();
          },
          async addAll(keys: CacheKey[]) {
            const responses = await Promise.all(keys.map(fetchResource));
            if (responses.some((response) => !response.ok)) throw new Error('Precache failed');
            keys.forEach((key, index) => {
              cache.set(keyOf(key), responses[index]);
              cachedHeaders.set(`${name}:${keyOf(key)}`, headersOf(key));
            });
          },
        });
      },
    },
  });

  async function dispatch(
    name: string,
    request?: WorkerEvent['request'],
    clientId = '',
    resultingClientId = '',
  ) {
    const lifetime: Promise<void>[] = [];
    const responses: Promise<Response>[] = [];
    const handler = handlers.get(name);
    assert.ok(handler, `Missing ${name} handler`);
    handler({
      request,
      clientId,
      resultingClientId,
      waitUntil: (work) => lifetime.push(work),
      respondWith: (response) => responses.push(response),
    });
    await Promise.all(lifetime);
    return responses[0];
  }

  return {
    requests,
    stores,
    dispatch,
    fetch: (asset: string, mode: RequestMode = 'cors', clientId = '', resultingClientId = '') =>
      dispatch(
        'fetch',
        {
          url: new URL(asset, scope).href,
          method: 'GET',
          mode,
          headers: new Headers(mode === 'cors' ? { Origin: new URL(scope).origin } : {}),
        },
        clientId,
        resultingClientId,
      ),
    goOffline: () => {
      offline = true;
    },
    failCacheWrites: () => {
      failWrites = true;
    },
    failCacheReads: () => {
      failReads = true;
    },
    failCacheOpens: () => {
      failOpens = true;
    },
    serveHtml: (asset: string) => {
      htmlUrl = new URL(asset, scope).href;
    },
    setClients: (nextClients: typeof clients) => {
      clients = nextClients;
    },
    failFetch: (asset: string) => {
      failedUrl = new URL(asset, scope).href;
    },
    getClaims: () => claims,
    getSkips: () => skips,
  };
}

void test('offline installation includes lazy chunks and templates but defers the WASM download', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  assert.ok(worker.requests.includes(new URL('assets/svg.js', scope).href));
  assert.ok(!worker.requests.some((url) => url.endsWith('.wasm')));
  worker.goOffline();

  for (const asset of assets.filter((entry) => !entry.fileName.endsWith('.wasm'))) {
    const response = await worker.fetch(asset.fileName);
    assert.equal(await response?.text(), asset.source);
  }
  const navigation = await worker.fetch('a/deep/link?query=1', 'navigate');
  assert.equal(await navigation?.text(), assets[0].source);
});

void test('updates activate immediately and retain old caches for existing editors', async () => {
  const worker = createWorker();
  worker.stores.set('memesquid-app-v1', new Map());
  worker.stores.set('transformers-cache', new Map());
  await worker.dispatch('install');
  assert.equal(worker.getClaims(), 0);
  assert.equal(worker.getSkips(), 1);
  assert.ok(worker.stores.has('memesquid-app-v1'));

  await worker.dispatch('activate');
  assert.equal(worker.getClaims(), 1);
  assert.ok(worker.stores.has('memesquid-app-v1'));
  assert.ok(worker.stores.has('transformers-cache'));
});

void test('missing lazy assets prevent incomplete offline installation', async () => {
  const worker = createWorker();
  worker.failFetch('assets/svg.js');
  await assert.rejects(worker.dispatch('install'), /Precache failed/);
  assert.equal(worker.getClaims(), 0);
  assert.equal(worker.getSkips(), 0);
  assert.equal(worker.stores.size, 0);
});

void test('cache write failure still returns a successful network response', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  worker.failCacheWrites();
  const response = await worker.fetch('assets/new-image.webp');
  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), 'Network response');
});

void test('build identity is deterministic and changes when an asset changes', () => {
  const worker = buildServiceWorker(assets);
  assert.equal(buildServiceWorker([...assets].reverse()), worker);
  assert.notEqual(
    buildServiceWorker(
      assets.map((asset) =>
        asset.fileName === 'index.html' ? { ...asset, source: '<html>editor v2</html>' } : asset,
      ),
    ),
    worker,
  );
});

void test('HTML returned for a missing precache chunk cannot install or replace a working build', async () => {
  const worker = createWorker();
  worker.stores.set('memesquid-app-old', new Map());
  worker.serveHtml('assets/svg.js');
  await assert.rejects(worker.dispatch('install'), /Invalid offline asset/);
  assert.equal(worker.getSkips(), 0);
  assert.deepEqual([...worker.stores.keys()], ['memesquid-app-old']);
});

void test('new navigations use the complete new build while old editors retain their hashed chunks', async () => {
  const worker = createWorker();
  const oldAsset = new URL('assets/editor-old.js', scope).href;
  worker.stores.set(
    'memesquid-app-old',
    new Map([
      [
        new URL('index.html', scope).href,
        new Response('<html>old broken build</html>', { headers: { 'Content-Type': 'text/html' } }),
      ],
      [
        oldAsset,
        new Response('old editor chunk', { headers: { 'Content-Type': 'text/javascript' } }),
      ],
    ]),
  );
  worker.setClients([
    { id: 'old-editor', url: scope },
    { id: 'new-editor', url: scope },
  ]);
  await worker.dispatch('install');
  await worker.dispatch('activate');
  worker.goOffline();

  const navigation = await worker.fetch('./', 'navigate', '', 'new-editor');
  assert.equal(await navigation?.text(), assets[0].source);
  const oldChunk = await worker.fetch('assets/editor-old.js', 'cors', 'old-editor');
  assert.equal(await oldChunk?.text(), 'old editor chunk');
  await worker.fetch('assets/editor.js', 'cors', 'new-editor');
  assert.ok(worker.stores.has('memesquid-app-old'));

  // Closing the last old tab permits cleanup; an in-progress future install must survive it.
  worker.setClients([{ id: 'new-editor', url: scope }]);
  worker.stores.set('memesquid-app-installing', new Map());
  worker.stores.set('transformers-cache', new Map());
  await worker.fetch('assets/editor.js', 'cors', 'new-editor');
  assert.ok(!worker.stores.has('memesquid-app-old'));
  assert.ok(worker.stores.has('memesquid-app-installing'));
  assert.ok(worker.stores.has('transformers-cache'));
});

void test('poisoned cached JavaScript is bypassed and repaired from the network', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const cache = [...worker.stores.values()][0];
  cache.set(
    new URL('assets/editor.js', scope).href,
    new Response('<html>wrong asset</html>', {
      headers: { 'Content-Type': 'text/html' },
    }),
  );
  const response = await worker.fetch('assets/editor.js');
  assert.equal(await response?.text(), 'editor v1');
  worker.goOffline();
  const repaired = await worker.fetch('assets/editor.js');
  assert.equal(await repaired?.text(), 'editor v1');
});

void test('HTML responses for missing runtime chunks are never cached', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  worker.serveHtml('assets/missing.js');
  await worker.fetch('assets/missing.js');
  for (const cache of worker.stores.values()) {
    assert.ok(!cache.has(new URL('assets/missing.js', scope).href));
  }
});

void test('cache read or open failures still allow online loading', async () => {
  for (const failure of ['read', 'open']) {
    const worker = createWorker();
    await worker.dispatch('install');
    if (failure === 'read') worker.failCacheReads();
    else worker.failCacheOpens();
    const response = await worker.fetch('assets/editor.js');
    assert.equal(await response?.text(), 'editor v1');
    const navigation = await worker.fetch('./', 'navigate');
    assert.equal(navigation?.status, 200);
  }
});

void test('network navigation after an evicted shell never overwrites the build cache', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const cache = [...worker.stores.values()][0];
  const indexUrl = new URL('index.html', scope).href;
  cache.delete(indexUrl);
  await worker.fetch('./', 'navigate');
  assert.ok(!cache.has(indexUrl));
  assert.equal(cache.get(scope), undefined);
});

void test('unrelated same-origin requests and service worker updates bypass the app cache', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  assert.equal(await worker.fetch('api/status'), undefined);
  assert.equal(await worker.fetch('sw.js'), undefined);
});

void test('registration survives a failed app bundle and resolves the worker from its own script', () => {
  const registrations: { url: string; options: RegistrationOptions }[] = [];
  const handlers = new Map<string, () => void>();
  runInNewContext(readFileSync(new URL('../../public/register-sw.js', import.meta.url), 'utf8'), {
    URL,
    document: { currentScript: { src: new URL('register-sw.js', scope).href } },
    navigator: {
      serviceWorker: {
        register(url: URL, options: RegistrationOptions) {
          registrations.push({ url: url.href, options });
          return Promise.resolve();
        },
      },
    },
    window: {
      addEventListener(name: string, handler: () => void) {
        handlers.set(name, handler);
      },
    },
  });
  assert.equal(registrations.length, 0);
  const load = handlers.get('load');
  assert.ok(load);
  load();
  assert.equal(registrations[0].url, new URL('sw.js', scope).href);
  assert.equal(registrations[0].options.updateViaCache, 'none');
});
