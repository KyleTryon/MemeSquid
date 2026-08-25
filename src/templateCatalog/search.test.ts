import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogTemplate, TemplateCatalog } from './catalog.ts';
import { normalizeTemplateSearchText, searchTemplateCatalog } from './search.ts';
import type { TemplateGroup } from './schemas.ts';

const groups: TemplateGroup[] = [
  {
    id: 'pokemon',
    kind: 'property',
    name: 'Pokémon',
    aliases: ['Pocket Monsters'],
    references: [],
  },
  {
    id: 'flork',
    kind: 'artist',
    name: 'Flork',
    aliases: ['Flork of Cows'],
    references: [],
  },
];

const templates: CatalogTemplate[] = [
  createTemplate({
    id: 'wild-pokemon-appears',
    title: 'Wild Pokémon Appears',
    aliases: ['wild x appears'],
    tags: ['pokemon', 'wild'],
    groupIds: ['pokemon'],
  }),
  createTemplate({
    id: 'flork-thumbs-up',
    title: 'Flork Thumbs Up',
    aliases: ['approval'],
    tags: ['reaction'],
    groupIds: ['flork'],
  }),
  createTemplate({
    id: 'unrelated',
    title: 'Unrelated Template',
    aliases: [],
    tags: ['example'],
    groupIds: [],
  }),
];

const catalog: TemplateCatalog = { groups, templates };

void test('template search normalizes punctuation and accents', () => {
  assert.equal(normalizeTemplateSearchText('Pokémon’s Choice'), 'pokemons choice');
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: 'pokemon appears', groupId: null }).map(({ id }) => id),
    ['wild-pokemon-appears'],
  );
});

void test('template search includes aliases, tags, and group metadata', () => {
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: 'approval', groupId: null }).map(({ id }) => id),
    ['flork-thumbs-up'],
  );
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: 'pocket monsters', groupId: null }).map(({ id }) => id),
    ['wild-pokemon-appears'],
  );
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: 'reaction', groupId: null }).map(({ id }) => id),
    ['flork-thumbs-up'],
  );
});

void test('template search filters by group and preserves title order without a query', () => {
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: '', groupId: 'flork' }).map(({ id }) => id),
    ['flork-thumbs-up'],
  );
  assert.deepEqual(
    searchTemplateCatalog(catalog, { query: '', groupId: null }).map(({ id }) => id),
    ['flork-thumbs-up', 'unrelated', 'wild-pokemon-appears'],
  );
});

function createTemplate(
  input: Pick<CatalogTemplate, 'aliases' | 'groupIds' | 'id' | 'tags' | 'title'>,
): CatalogTemplate {
  return {
    ...input,
    references: [],
    image: { width: 100, height: 100 },
    sourceUrl: `/templates/${input.id}/source.webp`,
    thumbnailUrl: `/templates/${input.id}/thumbnail.webp`,
  };
}
