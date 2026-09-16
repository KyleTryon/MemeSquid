import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEXT_ELEMENT_CLIPBOARD_TYPE,
  copyTextElement,
  createPastedTextElement,
  readCopiedTextElement,
} from './textClipboard';
import type { TextElement } from './types';

const caption: TextElement = {
  id: 'text-original',
  type: 'text',
  text: 'A styled caption 🦑',
  x: 12,
  y: 34,
  width: 220,
  fontSize: 48,
  fontFamily: 'Impact, sans-serif',
  fontWeight: 'bold',
  allCaps: true,
  align: 'center',
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 3,
  rotation: -15,
  shadowColor: '#123456',
  shadowBlur: 4,
  shadowOffsetX: -2,
  shadowOffsetY: 5,
  shadowOpacity: 0.5,
  zIndex: 7,
};

void test('copy and paste round-trip all text styling and provide readable plain text', () => {
  const data = new Map<string, string>();
  copyTextElement(
    {
      setData: (format, value) => {
        data.set(format, value);
      },
    },
    caption,
  );
  const decoded = readCopiedTextElement(data.get(TEXT_ELEMENT_CLIPBOARD_TYPE) ?? '');
  assert.deepEqual(decoded, caption);
  assert.notEqual(decoded, caption);
  assert.equal(data.get('text/plain'), 'A STYLED CAPTION 🦑');

  copyTextElement(
    {
      setData: (format, value) => {
        data.set(format, value);
      },
    },
    { ...caption, allCaps: false },
  );
  assert.equal(data.get('text/plain'), caption.text);
});

void test('copied text remains a snapshot when the original is edited or deleted', () => {
  const original = { ...caption };
  const data = new Map<string, string>();
  copyTextElement(
    {
      setData: (format, value) => {
        data.set(format, value);
      },
    },
    original,
  );
  original.text = 'Changed after copy';
  original.fill = '#ff0000';
  assert.deepEqual(readCopiedTextElement(data.get(TEXT_ELEMENT_CLIPBOARD_TYPE) ?? ''), caption);
});

void test('pasted layers have independent IDs and placement without changing their source', () => {
  const first = createPastedTextElement(caption, 20, 100);
  const second = createPastedTextElement(caption, 40, 101);
  assert.match(first.id, /^text-/);
  assert.notEqual(first.id, caption.id);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first, { ...caption, id: first.id, x: 32, y: 54, zIndex: 100 });
  assert.deepEqual(second, { ...caption, id: second.id, x: 52, y: 74, zIndex: 101 });
  assert.equal(caption.x, 12);
  assert.equal(caption.y, 34);
  first.text = 'Edited pasted layer';
  assert.equal(second.text, caption.text);
});

void test('clipboard parsing rejects malformed, unrelated, and invalid layer data', () => {
  for (const serialized of [
    '',
    'plain text',
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...caption, type: 'image' }),
    JSON.stringify({ ...caption, fontSize: 'large' }),
    JSON.stringify({ ...caption, x: null }),
    JSON.stringify({ ...caption, shadowBlur: '4' }),
    JSON.stringify({ ...caption, fontWeight: 'heavy' }),
    JSON.stringify({ ...caption, unexpectedProperty: true }),
  ]) {
    assert.equal(readCopiedTextElement(serialized), null);
  }
});

void test('clipboard parsing accepts text layers without optional layout or shadow settings', () => {
  const minimal: TextElement = {
    id: 'text-minimal',
    type: 'text',
    text: '',
    x: 0,
    y: 0,
    fontSize: 20,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    allCaps: false,
    align: 'left',
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 0,
  };
  assert.deepEqual(readCopiedTextElement(JSON.stringify(minimal)), minimal);
});
