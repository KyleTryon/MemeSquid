import {
  memeTemplateMetadataSchema,
  templateGroupSchema,
  type MemeTemplateMetadata,
  type TemplateGroup,
} from './schemas';

interface TemplateMetadataModule {
  default: unknown;
}

export interface CatalogTemplate extends MemeTemplateMetadata {
  sourceUrl: string;
  thumbnailUrl: string;
}

export interface TemplateCatalog {
  groups: readonly TemplateGroup[];
  templates: readonly CatalogTemplate[];
}

const groupModules = import.meta.glob<TemplateMetadataModule>('./groups/*.json', { eager: true });
const templateModules = import.meta.glob<TemplateMetadataModule>('./templates/*/template.json', {
  eager: true,
});
const sourceUrls = import.meta.glob<string>('./templates/*/source.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});
const thumbnailUrls = import.meta.glob<string>('./templates/*/thumbnail.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});

const groups = Object.entries(groupModules)
  .map(([path, module]) => {
    const group = templateGroupSchema.parse(module.default);
    assertPathId(path, group.id, /\/([^/]+)\.json$/u, 'group');
    return group;
  })
  .sort(compareByName);

const groupsById = new Map(groups.map((group) => [group.id, group]));

const templates = Object.entries(templateModules)
  .map(([path, module]) => {
    const template = memeTemplateMetadataSchema.parse(module.default);
    assertPathId(path, template.id, /\/templates\/([^/]+)\/template\.json$/u, 'template');

    for (const groupId of template.groupIds) {
      if (!groupsById.has(groupId)) {
        throw new Error(`Template "${template.id}" references missing group "${groupId}".`);
      }
    }

    const directory = path.slice(0, -'template.json'.length);
    const sourceUrl = sourceUrls[`${directory}source.webp`];
    const thumbnailUrl = thumbnailUrls[`${directory}thumbnail.webp`];
    if (!sourceUrl || !thumbnailUrl) {
      throw new Error(`Template "${template.id}" is missing its source or thumbnail image.`);
    }

    return { ...template, sourceUrl, thumbnailUrl };
  })
  .sort(compareByTitle);

export const templateCatalog: TemplateCatalog = { groups, templates };

function assertPathId(
  path: string,
  id: string,
  pattern: RegExp,
  recordType: 'group' | 'template',
): void {
  const pathId = pattern.exec(path)?.[1];
  if (pathId !== id) {
    throw new Error(`The ${recordType} ID "${id}" does not match its path "${path}".`);
  }
}

function compareByName(left: TemplateGroup, right: TemplateGroup): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareByTitle(left: MemeTemplateMetadata, right: MemeTemplateMetadata): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
