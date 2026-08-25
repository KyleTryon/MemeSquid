import type { CatalogTemplate, TemplateCatalog } from './catalog';
import type { TemplateGroup } from './schemas';

interface TemplateSearchOptions {
  groupId: string | null;
  query: string;
}

export function normalizeTemplateSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function getTemplateGroups(
  catalog: TemplateCatalog,
  template: CatalogTemplate,
): TemplateGroup[] {
  const groupIds = new Set(template.groupIds);
  return catalog.groups.filter((group) => groupIds.has(group.id));
}

export function searchTemplateCatalog(
  catalog: TemplateCatalog,
  { groupId, query }: TemplateSearchOptions,
): CatalogTemplate[] {
  const normalizedQuery = normalizeTemplateSearchText(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  return catalog.templates
    .filter((template) => !groupId || template.groupIds.includes(groupId))
    .map((template) => {
      const groups = getTemplateGroups(catalog, template);
      const title = normalizeTemplateSearchText(template.title);
      const aliases = template.aliases.map(normalizeTemplateSearchText);
      const haystack = normalizeTemplateSearchText(
        [
          template.title,
          ...template.aliases,
          ...template.tags,
          ...groups.flatMap((group) => [group.name, ...group.aliases]),
        ].join(' '),
      );
      const matches = queryTokens.every((token) => haystack.includes(token));

      let score = 0;
      if (!normalizedQuery) score = 1;
      else if (title === normalizedQuery) score = 100;
      else if (title.startsWith(normalizedQuery)) score = 80;
      else if (title.includes(normalizedQuery)) score = 60;
      else if (aliases.some((alias) => alias === normalizedQuery)) score = 50;
      else if (matches) score = 20;

      return { matches, score, template };
    })
    .filter(({ matches }) => matches)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.template.title.localeCompare(right.template.title) ||
        left.template.id.localeCompare(right.template.id),
    )
    .map(({ template }) => template);
}
