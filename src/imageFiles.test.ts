import assert from 'node:assert/strict';
import test from 'node:test';
import { copyCanvasToClipboard, downloadImage, readImageFile } from './imageFiles';

void test('image copying registers the clipboard write before asynchronous encoding finishes', async (context) => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousClipboardItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  class TestClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  const writes: TestClipboardItem[][] = [];
  const clipboard = {
    write: (items: TestClipboardItem[]) => {
      writes.push(items);
      return Promise.all(items.map((item) => item.data['image/png'])).then(() => {});
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard },
  });
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: TestClipboardItem,
  });
  context.after(() => {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (previousClipboardItem)
      Object.defineProperty(globalThis, 'ClipboardItem', previousClipboardItem);
    else Reflect.deleteProperty(globalThis, 'ClipboardItem');
  });

  const encoders: BlobCallback[] = [];
  const canvas = {
    toBlob: (callback: BlobCallback, type?: string) => {
      assert.equal(type, 'image/png');
      encoders.push(callback);
    },
  };
  const copied = copyCanvasToClipboard(canvas);
  assert.equal(writes.length, 1, 'write must run synchronously while the click is active');
  const blob = new Blob(['png'], { type: 'image/png' });
  encoders[0](blob);
  await copied;
  assert.equal(await writes[0][0].data['image/png'], blob);

  const failed = copyCanvasToClipboard(canvas);
  encoders[1](null);
  await assert.rejects(failed, /could not be copied/);

  const permissionError = new DOMException('Clipboard blocked', 'NotAllowedError');
  clipboard.write = () => Promise.reject(permissionError);
  const denied = copyCanvasToClipboard(canvas);
  await assert.rejects(denied, (error: Error) => error === permissionError);
  encoders[2](null);

  Reflect.deleteProperty(globalThis, 'ClipboardItem');
  assert.throws(() => copyCanvasToClipboard(canvas), /unavailable/);
});

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
