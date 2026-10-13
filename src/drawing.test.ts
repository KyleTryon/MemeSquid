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
  const points = Array.from({ length: 400 }, (_, index) => ({
    x: 14 + index * 4,
    y: 20 + Math.sin(((index + 1) * Math.PI) / 10) * 16,
  }));
  const measureWobble = (smoothing: number) => {
    let drawn = createDrawStroke({ ...stroke, smoothing }, { x: 10, y: 20 }, 1);
    let energy = 0;
    points.forEach((point, index) => {
      drawn = appendDrawPoint(drawn, point);
      // Exclude the startup transient and measure the whole motion, not one endpoint.
      if (index >= 200) energy += (drawn.filteredPoint.y - 20) ** 2;
    });
    return Math.sqrt(energy / 200);
  };
  const direct = measureWobble(0);
  const moderate = measureWobble(50);
  const strong = measureWobble(100);
  // An 80px-period, 32px-tall wobble must be visibly reduced at the maximum.
  assert.ok(strong < direct * 0.3, `maximum smoothing left ${strong / direct} of the wobble`);
  assert.ok(strong < moderate * 0.5);
  assert.ok(moderate < direct * 0.8);
});

void test('the full slider range produces clearly distinct stabilization strengths', () => {
  const end = { x: 410, y: 20 };
  const lag = (smoothing: number) => end.x - drawPath([end], smoothing).filteredPoint.x;
  assert.ok(lag(25) < 6);
  assert.ok(lag(50) > 18 && lag(50) < 22);
  assert.ok(lag(75) > 42 && lag(75) < 48);
  assert.ok(lag(100) > 75 && lag(100) < 81);
});

void test('strong smoothing rounds a deliberate turn instead of just skipping points', () => {
  const drawn = drawPath(
    [
      { x: 210, y: 20 },
      { x: 210, y: 100 },
    ],
    100,
  );
  assert.ok(drawn.filteredPoint.x < 190);
  assert.ok(drawn.filteredPoint.y < 60);
  assert.ok(
    drawn.line.points.some((value, index) => index % 2 === 0 && value > 150 && value < 190),
  );
  const finished = finishDrawStroke(drawn, drawn.pointer);
  assert.deepEqual(finished.points.slice(-2), [210, 100]);
  const tail = finished.points.slice(drawn.line.points.length - 2);
  for (let index = 2; index < tail.length; index += 2) {
    const dx = tail[index] - tail[index - 2];
    const dy = tail[index + 1] - tail[index - 1];
    assert.ok(Math.hypot(dx, dy) <= 2.01, 'settling must not add a long unsmoothed segment');
  }
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
