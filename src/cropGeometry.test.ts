import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyImageCrop,
  CROP_ASPECT_OPTIONS,
  fitCropToAspectRatio,
  getCropAspectRatio,
  getFullCrop,
} from './cropGeometry';
import type { ImageElement } from './types';

void test('crop presets have a single definition and Original uses the target dimensions', () => {
  const source = { width: 1200, height: 800 };
  assert.deepEqual(
    CROP_ASPECT_OPTIONS.map((option) => getCropAspectRatio(option.value, source)),
    [null, 1.5, 1, 0.8, 16 / 9],
  );
  assert.equal(getCropAspectRatio('original', { width: 600, height: 900 }), 2 / 3);
});

void test('choosing a ratio creates a centered preview without changing the canvas or previous draft', () => {
  const canvas = { width: 1200, height: 800 };
  const original = getFullCrop(canvas);
  const square = fitCropToAspectRatio(original, canvas, 1, 64);
  assert.deepEqual(square, { x: 200, y: 0, width: 800, height: 800 });
  assert.deepEqual(original, { x: 0, y: 0, width: 1200, height: 800 });
  assert.deepEqual(canvas, { width: 1200, height: 800 });
});

void test('locked crops retain their ratio, dimensions, and minimum size at every edge', () => {
  const bounds = { width: 1200, height: 800 };
  for (const ratio of [1, 4 / 5, 16 / 9, 1.5]) {
    for (const x of [-500, 100, 1500]) {
      for (const y of [-500, 100, 1000]) {
        const fitted = fitCropToAspectRatio({ x, y, width: 500, height: 500 }, bounds, ratio, 64);
        assert.ok(fitted);
        assert.ok(Math.abs(fitted.width / fitted.height - ratio) < 1e-10);
        assert.ok(fitted.width >= 64 && fitted.height >= 64);
        assert.ok(fitted.x >= 0 && fitted.y >= 0);
        assert.ok(fitted.x + fitted.width <= bounds.width + 1e-10);
        assert.ok(fitted.y + fitted.height <= bounds.height + 1e-10);
      }
    }
  }
});

void test('resizing a locked crop preserves the requested center and raises tiny drafts to the minimum', () => {
  assert.deepEqual(
    fitCropToAspectRatio(
      { x: 100, y: 100, width: 300, height: 200 },
      { width: 800, height: 600 },
      1,
      64,
    ),
    { x: 150, y: 100, width: 200, height: 200 },
  );
  const tiny = fitCropToAspectRatio(
    { x: 100, y: 100, width: 2, height: 2 },
    { width: 800, height: 600 },
    16 / 9,
    64,
  );
  assert.ok(tiny);
  assert.equal(tiny.height, 64);
  assert.equal(tiny.width, (64 * 16) / 9);
});

void test('ratios that cannot fit the minimum canvas dimensions are unavailable', () => {
  const bounds = { width: 64, height: 64 };
  assert.equal(fitCropToAspectRatio(getFullCrop(bounds), bounds, 16 / 9, 64), null);
  assert.equal(fitCropToAspectRatio(getFullCrop(bounds), bounds, 4 / 5, 64), null);
  assert.deepEqual(fitCropToAspectRatio(getFullCrop(bounds), bounds, 1, 64), getFullCrop(bounds));
  // Image crops retain their smaller one-pixel minimum.
  assert.ok(fitCropToAspectRatio(getFullCrop(bounds), bounds, 16 / 9));
});

void test('Free unlocks the current crop without resetting it; a full crop supplies reset geometry', () => {
  const bounds = { width: 800, height: 600 };
  const draft = { x: 50, y: 60, width: 320, height: 240 };
  assert.deepEqual(fitCropToAspectRatio(draft, bounds, null, 64), draft);
  assert.deepEqual(getFullCrop(bounds), { x: 0, y: 0, width: 800, height: 600 });
});

void test('applying a cropped image preserves transforms and the original snapshot needed for undo', (context) => {
  const previousImageType = Object.getOwnPropertyDescriptor(globalThis, 'HTMLImageElement');
  Object.defineProperty(globalThis, 'HTMLImageElement', { configurable: true, value: class {} });
  context.after(() => {
    if (previousImageType) Object.defineProperty(globalThis, 'HTMLImageElement', previousImageType);
    else Reflect.deleteProperty(globalThis, 'HTMLImageElement');
  });
  const original: ImageElement = {
    id: 'image-crop',
    type: 'image',
    image: { width: 800, height: 600 } as HTMLCanvasElement,
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    crop: { x: 0, y: 0, width: 800, height: 600 },
    rotation: 90,
    scaleX: -2,
    scaleY: 1.5,
  };
  const draft = fitCropToAspectRatio(original.crop, { width: 800, height: 600 }, 1);
  assert.ok(draft);
  const applied = applyImageCrop(original, draft);
  assert.equal(applied.width, 300);
  assert.equal(applied.height, 300);
  assert.equal(applied.rotation, 90);
  assert.equal(applied.scaleX, -2);
  assert.equal(applied.scaleY, 1.5);
  assert.ok(Math.abs(applied.x - 100) < 1e-10);
  assert.equal(applied.y, 100);
  assert.deepEqual(original.crop, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(original.width, 400);
  assert.equal(original.y, 200);
  assert.equal(applied.image, original.image);
  assert.deepEqual(applied.crop, draft);
});
