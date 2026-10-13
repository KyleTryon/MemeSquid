import assert from 'node:assert/strict';
import test from 'node:test';
import { updateItemById } from './collectionUtils';
import { appendDrawPoint, createDrawStroke, finishDrawStroke } from './drawing';
import type { ViewportPoint } from './canvasViewport';
import type { LineElement } from './types';

const stroke: LineElement = {
  id: 'line-active',
  type: 'line',
  points: [10, 20],
  color: '#ff0000',
  strokeWidth: 5,
  smoothing: 50,
};

const drawPath = (points: ViewportPoint[], smoothing: number, zoom = 1) =>
  points.reduce(
    appendDrawPoint,
    createDrawStroke({ ...stroke, smoothing }, { x: 10, y: 20 }, zoom),
  );

void test('smoothing damps jitter with stronger damping at higher values', () => {
  const points = Array.from({ length: 20 }, (_, index) => ({
    x: 12 + index * 2,
    y: index % 2 === 0 ? 22 : 18,
  }));
  const direct = drawPath(points, 0);
  const moderate = drawPath(points, 50);
  const strong = drawPath(points, 100);
  assert.ok(Math.abs(strong.filteredPoint.y - 20) < Math.abs(moderate.filteredPoint.y - 20));
  assert.ok(Math.abs(moderate.filteredPoint.y - 20) < Math.abs(direct.filteredPoint.y - 20));
  assert.ok(strong.filteredPoint.x < moderate.filteredPoint.x);
});

void test('direct drawing retains tiny movements and exactly follows the pointer', () => {
  const drawn = drawPath(
    [
      { x: 10.1, y: 20.2 },
      { x: 12, y: 23 },
    ],
    0,
  );
  assert.deepEqual(drawn.line.points, [10, 20, 10.1, 20.2, 12, 23]);
  assert.deepEqual(drawn.filteredPoint, { x: 12, y: 23 });
});

void test('drawing preserves immutable snapshots needed by undo', () => {
  const initial = createDrawStroke(stroke, { x: 10, y: 20 }, 1);
  assert.equal(appendDrawPoint(initial, initial.pointer), initial);
  const extended = appendDrawPoint(initial, { x: 30, y: 40 });
  assert.notEqual(extended.line, initial.line);
  assert.deepEqual(initial.line.points, [10, 20]);
  assert.deepEqual(stroke.points, [10, 20]);
  assert.deepEqual(initial.pointer, { x: 10, y: 20 });
});

void test('spatial smoothing is independent of pointer event density', () => {
  const sparse = drawPath(
    [
      { x: 50, y: 20 },
      { x: 50, y: 60 },
    ],
    50,
  );
  const dense = drawPath(
    [
      ...Array.from({ length: 40 }, (_, index) => ({ x: 11 + index, y: 20 })),
      ...Array.from({ length: 40 }, (_, index) => ({ x: 50, y: 21 + index })),
    ],
    50,
  );
  assert.ok(Math.abs(sparse.filteredPoint.x - dense.filteredPoint.x) < 1e-10);
  assert.ok(Math.abs(sparse.filteredPoint.y - dense.filteredPoint.y) < 1e-10);
});

void test('smoothing stays consistent in screen pixels across zoom levels', () => {
  const normal = drawPath([{ x: 50, y: 60 }], 50);
  for (const zoom of [0.25, 2, 4]) {
    const scaled = appendDrawPoint(createDrawStroke(stroke, { x: 10 / zoom, y: 20 / zoom }, zoom), {
      x: 50 / zoom,
      y: 60 / zoom,
    });
    assert.ok(Math.abs(scaled.filteredPoint.x * zoom - normal.filteredPoint.x) < 1e-10);
    assert.ok(Math.abs(scaled.filteredPoint.y * zoom - normal.filteredPoint.y) < 1e-10);
  }
});

void test('finishing preserves the start and exact release position at every strength', () => {
  for (const smoothing of [0, 1, 50, 100]) {
    const drawn = drawPath(
      [
        { x: 20, y: 21 },
        { x: 40, y: 35 },
      ],
      smoothing,
    );
    const finished = finishDrawStroke(drawn, { x: 41, y: 36 });
    assert.deepEqual(finished.points.slice(0, 2), [10, 20]);
    assert.deepEqual(finished.points.slice(-2), [41, 36]);
    assert.equal(finished.smoothing, smoothing);
    assert.deepEqual(drawn.pointer, { x: 40, y: 35 });
  }
});

void test('dots and subpixel smoothed strokes survive finishing without duplicate points', () => {
  const initial = createDrawStroke(stroke, { x: 10, y: 20 }, 1);
  assert.equal(finishDrawStroke(initial, initial.pointer), initial.line);
  const tiny = appendDrawPoint(initial, { x: 10.1, y: 20.1 });
  assert.equal(tiny.line, initial.line);
  assert.deepEqual(finishDrawStroke(tiny, tiny.pointer).points, [10, 20, 10.1, 20.1]);
});

void test('large pointer jumps remain finite and bound interpolation work', () => {
  const drawn = drawPath([{ x: 100000, y: -100000 }], 100);
  assert.ok(drawn.line.points.every(Number.isFinite));
  assert.ok(drawn.line.points.length <= 1026);
});

void test('pointer movement after undo neither recreates a removed stroke nor edits another', () => {
  const olderStroke = { ...stroke, id: 'line-older' };
  const drawn = drawPath([{ x: 30, y: 40 }], 50);
  const appendToActive = (lines: LineElement[]) =>
    updateItemById(lines, stroke.id, () => drawn.line);

  assert.deepEqual(appendToActive([]), []);
  assert.deepEqual(appendToActive([olderStroke]), [olderStroke]);
  assert.equal(appendToActive([olderStroke])[0], olderStroke);
});
