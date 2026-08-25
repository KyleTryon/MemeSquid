import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  addGroup,
  addTemplate,
  checkCatalog,
  createReferences,
  getCatalogPaths,
  slugify,
} from './catalogFiles.ts';

void test('slugify creates stable catalog IDs', () => {
  assert.equal(slugify('Really? Right In Front of My X?'), 'really-right-in-front-of-my-x');
  assert.equal(slugify('Artist’s Template'), 'artists-template');
});

void test('Know Your Meme references are normalized and host-restricted', () => {
  assert.deepEqual(
    createReferences({
      knowYourMemeUrl: 'https://www.knowyourmeme.com/memes/example/?tracking=yes#section',
    }),
    [{ kind: 'know-your-meme', url: 'https://knowyourmeme.com/memes/example' }],
  );
  assert.throws(
    () => createReferences({ knowYourMemeUrl: 'https://example.com/memes/example' }),
    /knowyourmeme\.com/u,
  );
});

void test('Imgflip template references accept IDs and canonicalize supported page URLs', () => {
  assert.deepEqual(createReferences({ imgflipTemplate: '516512053' }), [
    {
      kind: 'imgflip-template',
      templateId: '516512053',
      url: 'https://imgflip.com/memetemplate/516512053',
    },
  ]);
  assert.deepEqual(
    createReferences({
      imgflipTemplate: 'https://www.imgflip.com/meme/516512053/Flork?tracking=yes#example',
    }),
    [
      {
        kind: 'imgflip-template',
        templateId: '516512053',
        url: 'https://imgflip.com/memetemplate/516512053/Flork',
      },
    ],
  );
  assert.throws(
    () => createReferences({ imgflipTemplate: 'https://example.com/memetemplate/516512053' }),
    /imgflip\.com/u,
  );
});

void test('group and template additions are validated, processed, and transactional', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'memesquid-template-test-'));
  const paths = getCatalogPaths(projectRoot);
  const inputPath = path.join(projectRoot, 'input.png');

  try {
    await mkdir(paths.templates, { recursive: true });
    await mkdir(paths.groups, { recursive: true });
    await writeFile(path.join(paths.templates, '.gitkeep'), '');
    await writeFile(path.join(paths.groups, '.gitkeep'), '');
    await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 4,
        background: '#1560bd',
      },
    })
      .png()
      .toFile(inputPath);

    const group = await addGroup(projectRoot, {
      id: 'example-series',
      kind: 'series',
      name: 'Example Series',
      aliases: ['Example'],
      references: createReferences({
        knowYourMemeUrl: 'https://knowyourmeme.com/memes/example-series',
      }),
    });
    assert.equal(group.kind, 'series');

    const imgflipReference = createReferences({ imgflipTemplate: '516512053' });
    const result = await addTemplate(projectRoot, inputPath, {
      id: 'Example Template',
      title: 'Example Template',
      aliases: ['The Example'],
      tags: ['Image Macro', 'example'],
      groupIds: ['example-series'],
      references: imgflipReference,
    });

    assert.equal(result.metadata.id, 'example-template');
    assert.deepEqual(result.metadata.tags, ['example', 'image-macro']);
    assert.deepEqual(result.metadata.image, { width: 1200, height: 600 });
    assert.equal(
      (await sharp(path.join(result.destination, 'source.webp')).metadata()).format,
      'webp',
    );
    assert.ok(result.sourceBytes > 0);
    assert.ok(result.thumbnailBytes > 0);
    assert.deepEqual(await checkCatalog(projectRoot), []);

    const metadata = await readFile(path.join(result.destination, 'template.json'), 'utf8');
    assert.match(metadata, /"groupIds": \["example-series"\]/u);
    assert.match(metadata, /"templateId": "516512053"/u);

    await assert.rejects(
      addTemplate(projectRoot, inputPath, {
        id: 'duplicate-imgflip-id',
        title: 'Duplicate Imgflip ID',
        aliases: [],
        tags: [],
        groupIds: [],
        references: imgflipReference,
      }),
      /Imgflip template ID "516512053" is already used/u,
    );

    await assert.rejects(
      addTemplate(projectRoot, inputPath, {
        id: 'duplicate-image',
        title: 'Duplicate Image',
        aliases: [],
        tags: [],
        groupIds: [],
        references: [],
      }),
      /already used by template "example-template"/u,
    );
    await assert.rejects(
      addTemplate(projectRoot, inputPath, {
        id: 'unknown-group',
        title: 'Unknown Group',
        aliases: [],
        tags: [],
        groupIds: ['missing'],
        references: [],
      }),
      /Unknown group "missing"/u,
    );
    assert.deepEqual((await readdirTemplateNames(paths.templates)).sort(), [
      '.gitkeep',
      'example-template',
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test('dry runs do not write catalog entries', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'memesquid-template-dry-run-'));
  const paths = getCatalogPaths(projectRoot);
  const inputPath = path.join(projectRoot, 'input.png');

  try {
    await mkdir(paths.templates, { recursive: true });
    await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(inputPath);

    await addGroup(
      projectRoot,
      { id: 'preview', kind: 'property', name: 'Preview', aliases: [], references: [] },
      { dryRun: true },
    );
    const result = await addTemplate(
      projectRoot,
      inputPath,
      {
        id: 'preview',
        title: 'Preview',
        aliases: [],
        tags: [],
        groupIds: [],
        references: [],
      },
      { dryRun: true },
    );

    assert.equal(result.metadata.id, 'preview');
    assert.deepEqual(await readdirTemplateNames(paths.templates), []);
    await assert.rejects(readFile(path.join(paths.groups, 'preview.json')), /ENOENT/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function readdirTemplateNames(directory: string): Promise<string[]> {
  return readdir(directory);
}
