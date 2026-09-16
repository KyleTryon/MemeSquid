import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadImage, readImageFile } from './imageFiles';

void test('image file reads support raster and SVG input and reject read failures', async (context) => {
  const previousReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  const readers: TestReader[] = [];
  class TestReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload = () => {};
    onerror = () => {};
    onabort = () => {};
    mode = '';
    constructor() {
      readers.push(this);
    }
    readAsText() {
      this.mode = 'text';
    }
    readAsDataURL() {
      this.mode = 'data-url';
    }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestReader });
  context.after(() => {
    if (previousReader) Object.defineProperty(globalThis, 'FileReader', previousReader);
    else Reflect.deleteProperty(globalThis, 'FileReader');
  });
  const file = new File(['image'], 'image.png', { type: 'image/png' });
  const raster = readImageFile(file);
  const rasterReader = readers[0];
  assert.equal(rasterReader.mode, 'data-url');
  rasterReader.result = 'data:image/png;base64,aW1hZ2U=';
  rasterReader.onload();
  assert.equal(await raster, rasterReader.result);

  const svg = readImageFile(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }));
  const svgReader = readers[1];
  assert.equal(svgReader.mode, 'text');
  svgReader.result = '<svg/>';
  svgReader.onload();
  assert.equal(await svg, '<svg/>');

  const failed = readImageFile(file);
  const error = new DOMException('Unreadable file', 'NotReadableError');
  readers[2].error = error;
  readers[2].onerror();
  await assert.rejects(failed, (reason: Error) => reason === error);

  const aborted = readImageFile(file);
  readers[3].onabort();
  await assert.rejects(aborted, /interrupted/);

  const empty = readImageFile(file);
  readers[4].onload();
  await assert.rejects(empty, /could not be read/);
});

void test('invalid exports fail before creating a download link', () => {
  for (const uri of ['', 'data:,', 'data:image/png;base64,', 'https://example.com/image.png']) {
    assert.throws(() => downloadImage(uri, 'meme.png'), /could not be exported/);
  }
});

void test('download links are removed on both success and failure', (context) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let appended = 0;
  let removed = 0;
  let shouldFail = false;
  const link = {
    download: '',
    href: '',
    click: () => {
      if (shouldFail) throw new Error('Download blocked');
    },
    remove: () => {
      removed += 1;
    },
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => link,
      body: {
        appendChild: () => {
          appended += 1;
        },
      },
    },
  });
  context.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const uri = 'data:image/png;base64,aW1hZ2U=';
  downloadImage(uri, 'meme.png');
  assert.equal(link.href, uri);
  assert.equal(link.download, 'meme.png');
  assert.equal(removed, 1);
  shouldFail = true;
  assert.throws(() => downloadImage(uri, 'meme.png'), /Download blocked/);
  assert.equal(appended, 2);
  assert.equal(removed, 2);
});
