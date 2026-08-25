import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampZoom,
  getLogicalPointAtClientPosition,
  getPinchZoom,
  getPointCenter,
  getPointDistance,
  getScrollDeltaForLogicalPoint,
} from './canvasViewport';

void test('canvas gesture geometry calculates centers and distances', () => {
  assert.deepEqual(getPointCenter({ x: 10, y: 20 }, { x: 30, y: 60 }), { x: 20, y: 40 });
  assert.equal(getPointDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

void test('pinch zoom scales proportionally and respects limits', () => {
  assert.equal(getPinchZoom(0.5, 100, 200, 0.05, 4), 1);
  assert.equal(getPinchZoom(1, 100, 1000, 0.05, 4), 4);
  assert.equal(getPinchZoom(1, 100, 1, 0.05, 4), 0.05);
  assert.equal(getPinchZoom(0.5, 0, 200, 0.05, 4), 0.5);
  assert.equal(clampZoom(8, 0.05, 4), 4);
});

void test('focal point scroll delta keeps the same canvas point under the gesture center', () => {
  const logicalPoint = getLogicalPointAtClientPosition(
    { left: 20, top: 40 },
    { x: 120, y: 140 },
    0.5,
  );
  assert.deepEqual(logicalPoint, { x: 200, y: 200 });

  const delta = getScrollDeltaForLogicalPoint(
    { left: -30, top: -10 },
    { x: 130, y: 150 },
    logicalPoint,
    1,
  );
  assert.deepEqual(delta, { x: 40, y: 40 });
});
