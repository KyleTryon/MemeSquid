import assert from 'node:assert/strict';
import test from 'node:test';
import { updateItemById } from './collectionUtils';
import { appendDrawPoint } from './drawing';
import type { LineElement } from './types';

const stroke: LineElement = {
  id: 'line-active',
  type: 'line',
  points: [10, 20],
  color: '#ff0000',
  strokeWidth: 5,
};

void test('drawing filters jitter without changing snapshots needed by undo', () => {
  assert.equal(appendDrawPoint(stroke, { x: 12, y: 23 }), stroke);
  const extended = appendDrawPoint(stroke, { x: 13, y: 24 });
  assert.deepEqual(extended.points, [10, 20, 13, 24]);
  assert.deepEqual(stroke.points, [10, 20]);
  assert.notEqual(extended, stroke);
});

void test('pointer movement after undo neither recreates a removed stroke nor edits another', () => {
  const olderStroke = { ...stroke, id: 'line-older' };
  const appendToActive = (lines: LineElement[]) =>
    updateItemById(lines, stroke.id, (line) => appendDrawPoint(line, { x: 30, y: 40 }));

  assert.deepEqual(appendToActive([]), []);
  assert.deepEqual(appendToActive([olderStroke]), [olderStroke]);
  assert.equal(appendToActive([olderStroke])[0], olderStroke);
});
