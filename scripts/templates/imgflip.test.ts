import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { parseImgflipTemplateInput } from './catalogFiles.ts';
import { resolveImgflipTemplate, type FetchTemplateResource } from './imgflip.ts';

void test('Imgflip resolver extracts the title and downloads the primary image', async () => {
  const image = await sharp({
    create: {
      width: 736,
      height: 709,
      channels: 3,
      background: '#ffffff',
    },
  })
    .png()
    .toBuffer();
  const html = `<!doctype html>
    <head><title>Flork Blank Template - Imgflip</title></head>
    <body><img class="base-img" src="//i.imgflip.com/example.png?x=1&amp;y=2"></body>`;
  const requestedUrls: string[] = [];
  const fetchResource: FetchTemplateResource = (input) => {
    const url = input.toString();
    requestedUrls.push(url);
    if (url.includes('/memetemplate/')) {
      return Promise.resolve(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    }
    return Promise.resolve(
      new Response(new Uint8Array(image), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
  };

  const result = await resolveImgflipTemplate(
    parseImgflipTemplateInput('https://imgflip.com/memetemplate/516512053/Flork'),
    fetchResource,
  );

  assert.equal(result.title, 'Flork');
  assert.equal(result.reference.templateId, '516512053');
  assert.equal(result.imageUrl, 'https://i.imgflip.com/example.png?x=1&y=2');
  assert.deepEqual(requestedUrls, [
    'https://imgflip.com/memetemplate/516512053/Flork',
    'https://i.imgflip.com/example.png?x=1&y=2',
  ]);
  assert.deepEqual(result.image, image);
});

void test('Imgflip resolver canonicalizes legacy slug-only template URLs', async () => {
  const html = `<!doctype html>
    <title>X, X Everywhere Blank Meme Template - Imgflip</title>
    <img id="mtm-img" src="/s/meme/X-X-Everywhere.jpg">
    <p>Template ID: 91538330</p>`;
  const fetchResource: FetchTemplateResource = (input) => {
    const url = input.toString();
    return Promise.resolve(
      url.endsWith('.jpg')
        ? new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          })
        : new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
    );
  };

  const result = await resolveImgflipTemplate(
    parseImgflipTemplateInput('https://imgflip.com/memetemplate/X-X-Everywhere'),
    fetchResource,
  );

  assert.equal(result.title, 'X, X Everywhere');
  assert.equal(result.imageUrl, 'https://imgflip.com/s/meme/X-X-Everywhere.jpg');
  assert.deepEqual(result.reference, {
    kind: 'imgflip-template',
    templateId: '91538330',
    url: 'https://imgflip.com/memetemplate/91538330/X-X-Everywhere',
  });
});

void test('Imgflip resolver rejects image URLs outside Imgflip', async () => {
  const fetchResource: FetchTemplateResource = () =>
    Promise.resolve(
      new Response('<meta property="og:image" content="https://example.com/image.png">', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

  await assert.rejects(
    resolveImgflipTemplate(parseImgflipTemplateInput('516512053'), fetchResource),
    /unsupported host/u,
  );
});
