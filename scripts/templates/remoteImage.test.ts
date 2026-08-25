import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { downloadRemoteImage, type FetchImageResource } from './remoteImage.ts';

void test('remote image downloader accepts HTTPS raster images', async () => {
  const image = await sharp({
    create: {
      width: 80,
      height: 40,
      channels: 3,
      background: '#1560bd',
    },
  })
    .png()
    .toBuffer();
  const requestedUrls: string[] = [];
  const fetchResource: FetchImageResource = (input) => {
    requestedUrls.push(input.toString());
    return Promise.resolve(
      new Response(new Uint8Array(image), {
        headers: { 'content-type': 'image/png' },
        status: 200,
      }),
    );
  };

  const result = await downloadRemoteImage('https://example.com/template.png', {
    fetchResource,
  });

  assert.deepEqual(requestedUrls, ['https://example.com/template.png']);
  assert.equal(result.url, 'https://example.com/template.png');
  assert.deepEqual(result.image, image);
});

void test('remote image downloader rejects insecure URLs and embedded credentials', async () => {
  await assert.rejects(downloadRemoteImage('http://example.com/template.png'), /must use HTTPS/u);
  await assert.rejects(
    downloadRemoteImage('https://user:secret@example.com/template.png'),
    /cannot contain credentials/u,
  );
});

void test('remote image downloader rejects non-image and oversized responses', async () => {
  const nonImageFetch: FetchImageResource = () =>
    Promise.resolve(
      new Response('not an image', {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      }),
    );
  await assert.rejects(
    downloadRemoteImage('https://example.com/template', { fetchResource: nonImageFetch }),
    /unexpected content type/u,
  );

  const oversizedFetch: FetchImageResource = () =>
    Promise.resolve(
      new Response(new Uint8Array([1]), {
        headers: { 'content-length': String(26 * 1024 * 1024), 'content-type': 'image/png' },
        status: 200,
      }),
    );
  await assert.rejects(
    downloadRemoteImage('https://example.com/template.png', { fetchResource: oversizedFetch }),
    /25 MiB download limit/u,
  );
});
