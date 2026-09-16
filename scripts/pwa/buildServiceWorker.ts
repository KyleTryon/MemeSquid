import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

interface AppAsset {
  fileName: string;
  source: string | Uint8Array;
}

export function buildServiceWorker(assets: readonly AppAsset[]): string {
  const workerSource = readFileSync(new URL('./serviceWorker.js', import.meta.url), 'utf8');
  // The large WASM runtime and model are cached only when background removal is used.
  const cachedAssets = assets
    .filter((asset) => !asset.fileName.endsWith('.wasm'))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  const digest = createHash('sha256').update(workerSource);
  for (const asset of cachedAssets) digest.update(asset.fileName).update(asset.source);

  const cacheName = `memesquid-app-${digest.digest('hex').slice(0, 16)}`;
  const urls = ['./', ...cachedAssets.map((asset) => `./${asset.fileName}`)];
  return `const CACHE_NAME = ${JSON.stringify(cacheName)};\nconst PRECACHE_ASSETS = ${JSON.stringify(urls)};\n${workerSource}`;
}

export function offlineAppPlugin(): Plugin {
  let publicDirectory = '';

  return {
    name: 'memesquid-offline-app',
    apply: 'build',
    configResolved(config) {
      publicDirectory = config.publicDir;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets: AppAsset[] = Object.values(bundle).map((output) => ({
          fileName: output.fileName,
          source: output.type === 'chunk' ? output.code : output.source,
        }));
        if (publicDirectory) {
          for (const file of readdirSync(publicDirectory, {
            recursive: true,
            withFileTypes: true,
          })) {
            if (!file.isFile()) continue;
            const filePath = path.join(file.parentPath, file.name);
            assets.push({
              fileName: path.relative(publicDirectory, filePath).split(path.sep).join('/'),
              source: readFileSync(filePath),
            });
          }
        }

        this.emitFile({ type: 'asset', fileName: 'sw.js', source: buildServiceWorker(assets) });
      },
    },
  };
}
