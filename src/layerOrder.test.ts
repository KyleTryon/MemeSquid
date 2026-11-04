import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyZIndexes,
  getLayerOrderAvailability,
  getTopZIndex,
  reorderLayer,
  sortLayers,
  type LayerOrderAction,
} from './layerOrder';

const layer = (id: string, zIndex?: number): { id: string; type: string; zIndex?: number } => ({
  id,
  type: id.startsWith('line') ? 'line' : 'image',
  zIndex,
});

const layers = [
  layer('image-a', 10),
  layer('line-1', 20),
  layer('line-2', 30),
  layer('text-b', 40),
  layer('image-c', 50),
];

const orderAfter = (action: LayerOrderAction, id: string, input = layers): string[] => {
  const zIndexes = reorderLayer(input, id, action);
  assert.ok(zIndexes, `expected ${action} to move ${id}`);
  return sortLayers(applyZIndexes(input, zIndexes)).map((item) => item.id);
};

void test('sorts layers bottom to top and keeps input order for ties', () => {
  const unordered = [layer('b', 2), layer('a', 1), layer('c', 2), layer('d')];
  assert.deepEqual(
    sortLayers(unordered).map((item) => item.id),
    ['d', 'a', 'b', 'c'],
  );
});

void test('finds the top z-index across layer kinds', () => {
  assert.equal(getTopZIndex([]), 0);
  assert.equal(getTopZIndex(layers), 50);
});

void test('moves a layer to the front or back', () => {
  assert.deepEqual(orderAfter('front', 'image-a'), [
    'line-1',
    'line-2',
    'text-b',
    'image-c',
    'image-a',
  ]);
  assert.deepEqual(orderAfter('back', 'image-c'), [
    'image-c',
    'image-a',
    'line-1',
    'line-2',
    'text-b',
  ]);
});

void test('steps past consecutive drawing strokes as one layer', () => {
  assert.deepEqual(orderAfter('forward', 'image-a'), [
    'line-1',
    'line-2',
    'image-a',
    'text-b',
    'image-c',
  ]);
  assert.deepEqual(orderAfter('backward', 'text-b'), [
    'image-a',
    'text-b',
    'line-1',
    'line-2',
    'image-c',
  ]);
});

void test('steps past a single layer', () => {
  assert.deepEqual(orderAfter('forward', 'text-b'), [
    'image-a',
    'line-1',
    'line-2',
    'image-c',
    'text-b',
  ]);
  assert.deepEqual(orderAfter('backward', 'image-c'), [
    'image-a',
    'line-1',
    'line-2',
    'image-c',
    'text-b',
  ]);
});

void test('a layer between strokes splits them into separate drawings', () => {
  const split = [layer('line-1', 1), layer('image-a', 2), layer('line-2', 3), layer('line-3', 4)];
  assert.deepEqual(orderAfter('forward', 'image-a', split), [
    'line-1',
    'line-2',
    'line-3',
    'image-a',
  ]);
  assert.deepEqual(orderAfter('backward', 'image-a', split), [
    'image-a',
    'line-1',
    'line-2',
    'line-3',
  ]);
});

void test('returns sequential z-indexes for every layer', () => {
  const zIndexes = reorderLayer(layers, 'image-a', 'front');
  assert.deepEqual(
    [...(zIndexes?.values() ?? [])].sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
});

void test('returns null when the layer cannot move', () => {
  assert.equal(reorderLayer(layers, 'image-c', 'front'), null);
  assert.equal(reorderLayer(layers, 'image-c', 'forward'), null);
  assert.equal(reorderLayer(layers, 'image-a', 'back'), null);
  assert.equal(reorderLayer(layers, 'image-a', 'backward'), null);
  assert.equal(reorderLayer(layers, 'missing', 'front'), null);
});

void test('reports which directions a layer can move', () => {
  assert.deepEqual(getLayerOrderAvailability(layers, 'image-a'), {
    canMoveUp: true,
    canMoveDown: false,
  });
  assert.deepEqual(getLayerOrderAvailability(layers, 'text-b'), {
    canMoveUp: true,
    canMoveDown: true,
  });
  assert.deepEqual(getLayerOrderAvailability(layers, 'missing'), {
    canMoveUp: false,
    canMoveDown: false,
  });
});

void test('keeps unchanged items and arrays by reference', () => {
  const items = [layer('a', 1), layer('b', 2)];
  assert.equal(applyZIndexes(items, new Map([['a', 1]])), items);
  const next = applyZIndexes(items, new Map([['a', 3]]));
  assert.notEqual(next, items);
  assert.equal(next[1], items[1]);
  assert.equal(next[0].zIndex, 3);
});
