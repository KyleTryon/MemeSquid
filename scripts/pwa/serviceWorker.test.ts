import assert from 'node:assert/strict';
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
  let failedUrl: string | null = null;
  let claims = 0;
  const fetchResource = (key: CacheKey): Promise<Response> => {
    const url = keyOf(key);
    requests.push(url);
    if (offline) return Promise.reject(new Error('Offline'));
    if (url === failedUrl) return Promise.resolve(new Response('Missing', { status: 404 }));
    const asset = assets.find((entry) => new URL(entry.fileName, scope).href === url);
    return Promise.resolve(
      new Response(asset?.source ?? 'Network response', { headers: { Vary: 'Origin' } }),
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
      clients: {
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
        let store = stores.get(name);
        if (!store) {
          store = new Map<string, Response>();
          stores.set(name, store);
        }
        const cache = store;
        return Promise.resolve({
          match: (key: CacheKey, options?: CacheQueryOptions) => {
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

  async function dispatch(name: string, request?: WorkerEvent['request']) {
    const lifetime: Promise<void>[] = [];
    const responses: Promise<Response>[] = [];
    const handler = handlers.get(name);
    assert.ok(handler, `Missing ${name} handler`);
    handler({
      request,
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
    fetch: (asset: string, mode: RequestMode = 'cors') =>
      dispatch('fetch', {
        url: new URL(asset, scope).href,
        method: 'GET',
        mode,
        headers: new Headers(mode === 'cors' ? { Origin: new URL(scope).origin } : {}),
      }),
    goOffline: () => {
      offline = true;
    },
    failCacheWrites: () => {
      failWrites = true;
    },
    failFetch: (asset: string) => {
      failedUrl = new URL(asset, scope).href;
    },
    getClaims: () => claims,
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

void test('updates cache a complete build and retain old caches until activation', async () => {
  const worker = createWorker();
  worker.stores.set('memesquid-app-v1', new Map());
  worker.stores.set('transformers-cache', new Map());
  await worker.dispatch('install');
  assert.equal(worker.getClaims(), 0);
  assert.ok(worker.stores.has('memesquid-app-v1'));

  await worker.dispatch('activate');
  assert.equal(worker.getClaims(), 1);
  assert.ok(!worker.stores.has('memesquid-app-v1'));
  assert.ok(worker.stores.has('transformers-cache'));
});

void test('missing lazy assets prevent incomplete offline installation', async () => {
  const worker = createWorker();
  worker.failFetch('assets/svg.js');
  await assert.rejects(worker.dispatch('install'), /Precache failed/);
  assert.equal(worker.getClaims(), 0);
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
