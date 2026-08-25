import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';
import sharp from 'sharp';
import type { z } from 'zod';
import { templateImageConfig } from '../../src/templateCatalog/imageConfig.ts';
import {
  memeTemplateMetadataSchema,
  templateGroupSchema,
  type CatalogReference,
  type ImgflipTemplateReference,
  type MemeTemplateMetadata,
  type TemplateGroup,
  type TemplateGroupKind,
} from '../../src/templateCatalog/schemas.ts';

const TEMPLATE_FILES = ['source.webp', 'template.json', 'thumbnail.webp'] as const;
const SUPPORTED_INPUT_FORMATS = new Set(['avif', 'jpeg', 'png', 'webp']);

export type TemplateImageInput = string | Buffer;

export type ParsedImgflipTemplateInput =
  | { type: 'reference'; reference: ImgflipTemplateReference }
  | { type: 'slug'; slug: string; url: string };

export interface CatalogPaths {
  root: string;
  catalog: string;
  groups: string;
  templates: string;
}

export interface GroupDraft {
  id: string;
  kind: TemplateGroupKind;
  name: string;
  aliases: readonly string[];
  references: readonly CatalogReference[];
}

export interface TemplateDraft {
  id: string;
  title: string;
  aliases: readonly string[];
  tags: readonly string[];
  groupIds: readonly string[];
  references: readonly CatalogReference[];
}

export interface AddedTemplate {
  metadata: MemeTemplateMetadata;
  destination: string;
  sourceBytes: number;
  thumbnailBytes: number;
}

export interface AddOptions {
  dryRun?: boolean;
}

export function getCatalogPaths(projectRoot: string): CatalogPaths {
  const catalog = path.join(projectRoot, 'src', 'templateCatalog');
  return {
    root: projectRoot,
    catalog,
    groups: path.join(catalog, 'groups'),
    templates: path.join(catalog, 'templates'),
  };
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function normalizeStringList(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (value) unique.set(value.toLowerCase(), value);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right));
}

export function createReferences(input: {
  imgflipTemplate?: string;
  knowYourMemeUrl?: string;
  sourceUrl?: string;
}): CatalogReference[] {
  const references: CatalogReference[] = [];
  if (input.knowYourMemeUrl?.trim()) {
    references.push({
      kind: 'know-your-meme',
      url: normalizeReferenceUrl('know-your-meme', input.knowYourMemeUrl),
    });
  }
  if (input.sourceUrl?.trim()) {
    references.push({ kind: 'source', url: normalizeReferenceUrl('source', input.sourceUrl) });
  }
  if (input.imgflipTemplate?.trim()) {
    references.push(createImgflipReference(input.imgflipTemplate));
  }
  return references.sort(compareReferences);
}

export function createImgflipReference(rawReference: string): ImgflipTemplateReference {
  const parsed = parseImgflipTemplateInput(rawReference);
  if (parsed.type === 'slug') {
    throw new Error('Slug-only Imgflip URLs must be resolved before creating a catalog reference.');
  }
  return parsed.reference;
}

export function parseImgflipTemplateInput(rawReference: string): ParsedImgflipTemplateInput {
  const value = rawReference.trim();
  if (/^\d+$/u.test(value)) {
    return {
      type: 'reference',
      reference: {
        kind: 'imgflip-template',
        templateId: value,
        url: `https://imgflip.com/memetemplate/${value}`,
      },
    };
  }

  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Imgflip template URLs must use HTTPS.');
  if (url.username || url.password) {
    throw new Error('Imgflip template URLs cannot contain credentials.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'imgflip.com' && hostname !== 'www.imgflip.com') {
    throw new Error('Imgflip template URLs must use imgflip.com.');
  }

  const idMatch = /^\/(?:meme|memegenerator|memetemplate)\/(\d+)(?:\/([^/]+))?\/?$/u.exec(
    url.pathname,
  );
  if (idMatch) {
    const [, templateId, slug] = idMatch;
    return {
      type: 'reference',
      reference: {
        kind: 'imgflip-template',
        templateId,
        url: `https://imgflip.com/memetemplate/${templateId}${slug ? `/${slug}` : ''}`,
      },
    };
  }

  const slug = /^\/memetemplate\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
  if (!slug) {
    throw new Error('Use an Imgflip template ID or /memetemplate/{id-or-slug} URL.');
  }
  return {
    type: 'slug',
    slug,
    url: `https://imgflip.com/memetemplate/${slug}`,
  };
}

export async function readGroups(projectRoot: string): Promise<TemplateGroup[]> {
  const { groups } = getCatalogPaths(projectRoot);
  const entries = await readDirectoryOrEmpty(groups);
  const records: TemplateGroup[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;
    const filePath = path.join(groups, entry.name);
    const record = await parseJsonFile(filePath, templateGroupSchema);
    if (`${record.id}.json` !== entry.name) {
      throw new Error(`Group ID "${record.id}" does not match filename "${entry.name}".`);
    }
    records.push(record);
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export async function addGroup(
  projectRoot: string,
  draft: GroupDraft,
  options: AddOptions = {},
): Promise<TemplateGroup> {
  const paths = getCatalogPaths(projectRoot);
  const group = canonicalizeGroup(draft);
  const destination = path.join(paths.groups, `${group.id}.json`);
  await assertPathMissing(destination, `Group "${group.id}" already exists.`);

  const existingGroups = await readGroups(projectRoot);
  const duplicateName = existingGroups.find(
    ({ name }) => name.toLowerCase() === group.name.toLowerCase(),
  );
  if (duplicateName) {
    throw new Error(`Group name "${group.name}" is already used by "${duplicateName.id}".`);
  }

  if (options.dryRun) return group;

  await mkdir(paths.groups, { recursive: true });
  const temporary = path.join(paths.groups, `.tmp-${group.id}-${randomUUID()}.json`);
  try {
    await writeFile(temporary, await stringifyRecord(group), { flag: 'wx' });
    await link(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await unlink(temporary).catch(() => undefined);
  return group;
}

export async function addTemplate(
  projectRoot: string,
  imageInput: TemplateImageInput,
  draft: TemplateDraft,
  options: AddOptions = {},
): Promise<AddedTemplate> {
  const paths = getCatalogPaths(projectRoot);
  const normalizedId = slugify(draft.id);
  if (!normalizedId) throw new Error('Template ID must contain at least one letter or number.');
  const normalizedDraft = { ...draft, id: normalizedId };
  const destination = path.join(paths.templates, normalizedId);
  await assertPathMissing(destination, `Template "${normalizedId}" already exists.`);

  const groups = await readGroups(projectRoot);
  const groupIds = new Set(groups.map(({ id }) => id));
  for (const groupId of normalizedDraft.groupIds) {
    if (!groupIds.has(groupId)) {
      throw new Error(`Unknown group "${groupId}". Add it with "pnpm template:group:add" first.`);
    }
  }

  await assertUniqueImgflipReference(paths.templates, normalizedDraft.references);

  const { source, thumbnail, width, height } = await processTemplateImage(imageInput);
  await assertUniqueSourceImage(paths.templates, source);

  const metadata = canonicalizeTemplate({ ...normalizedDraft, image: { width, height } });
  const result: AddedTemplate = {
    metadata,
    destination,
    sourceBytes: source.byteLength,
    thumbnailBytes: thumbnail.byteLength,
  };
  if (options.dryRun) return result;

  await mkdir(paths.templates, { recursive: true });
  const temporary = await mkdtemp(path.join(paths.templates, `.tmp-${metadata.id}-`));
  try {
    const metadataJson = await stringifyRecord(metadata);
    await Promise.all([
      writeFile(path.join(temporary, 'source.webp'), source, { flag: 'wx' }),
      writeFile(path.join(temporary, 'thumbnail.webp'), thumbnail, { flag: 'wx' }),
      writeFile(path.join(temporary, 'template.json'), metadataJson, { flag: 'wx' }),
    ]);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  return result;
}

export async function checkCatalog(projectRoot: string): Promise<string[]> {
  const paths = getCatalogPaths(projectRoot);
  const errors: string[] = [];
  const groups = await collectValidGroups(paths, errors);
  const groupIds = new Set(groups.map(({ id }) => id));
  const entries = await readDirectoryOrEmpty(paths.templates);
  const sourceHashes = new Map<string, string>();
  const imgflipTemplateIds = new Map<string, string>();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.gitkeep') continue;
    if (!entry.isDirectory()) {
      errors.push(`Unexpected file in templates directory: ${entry.name}`);
      continue;
    }
    if (entry.name.startsWith('.tmp-')) {
      errors.push(`Incomplete temporary template directory: ${entry.name}`);
      continue;
    }

    await checkTemplateDirectory(
      paths,
      entry.name,
      groupIds,
      sourceHashes,
      imgflipTemplateIds,
      errors,
    );
  }

  return errors;
}

async function collectValidGroups(paths: CatalogPaths, errors: string[]): Promise<TemplateGroup[]> {
  const records: TemplateGroup[] = [];
  const entries = await readDirectoryOrEmpty(paths.groups);
  const ids = new Set<string>();
  const names = new Map<string, string>();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.gitkeep') continue;
    if (!entry.isFile() || path.extname(entry.name) !== '.json') {
      errors.push(`Unexpected entry in groups directory: ${entry.name}`);
      continue;
    }

    const filePath = path.join(paths.groups, entry.name);
    try {
      const raw = await readFile(filePath, 'utf8');
      const group = parseJson(raw, templateGroupSchema, filePath);
      if (entry.name !== `${group.id}.json`) {
        errors.push(`Group ID "${group.id}" does not match filename "${entry.name}".`);
      }
      if (ids.has(group.id)) errors.push(`Duplicate group ID: ${group.id}`);
      ids.add(group.id);

      const normalizedName = group.name.toLowerCase();
      const existingId = names.get(normalizedName);
      if (existingId) {
        errors.push(`Group name "${group.name}" is shared by "${existingId}" and "${group.id}".`);
      }
      names.set(normalizedName, group.id);

      records.push(group);
    } catch (error) {
      errors.push(formatError(error));
    }
  }
  return records;
}

async function checkTemplateDirectory(
  paths: CatalogPaths,
  id: string,
  groupIds: ReadonlySet<string>,
  sourceHashes: Map<string, string>,
  imgflipTemplateIds: Map<string, string>,
  errors: string[],
): Promise<void> {
  const directory = path.join(paths.templates, id);
  const entries = await readdir(directory);
  const expectedFiles = new Set<string>(TEMPLATE_FILES);
  for (const filename of entries) {
    if (!expectedFiles.has(filename))
      errors.push(`Unexpected file in template "${id}": ${filename}`);
  }
  for (const filename of TEMPLATE_FILES) {
    if (!entries.includes(filename)) errors.push(`Template "${id}" is missing ${filename}.`);
  }
  if (!TEMPLATE_FILES.every((filename) => entries.includes(filename))) return;

  const metadataPath = path.join(directory, 'template.json');
  const sourcePath = path.join(directory, 'source.webp');
  const thumbnailPath = path.join(directory, 'thumbnail.webp');

  try {
    const raw = await readFile(metadataPath, 'utf8');
    const metadata = parseJson(raw, memeTemplateMetadataSchema, metadataPath);
    if (metadata.id !== id)
      errors.push(`Template ID "${metadata.id}" does not match directory "${id}".`);
    for (const groupId of metadata.groupIds) {
      if (!groupIds.has(groupId))
        errors.push(`Template "${id}" references missing group "${groupId}".`);
    }
    const imgflipReference = metadata.references.find(
      (reference) => reference.kind === 'imgflip-template',
    );
    if (imgflipReference) {
      const existingId = imgflipTemplateIds.get(imgflipReference.templateId);
      if (existingId) {
        errors.push(
          `Templates "${existingId}" and "${id}" share Imgflip template ID "${imgflipReference.templateId}".`,
        );
      }
      imgflipTemplateIds.set(imgflipReference.templateId, id);
    }
    const [sourceMetadata, thumbnailMetadata, source] = await Promise.all([
      sharp(sourcePath).metadata(),
      sharp(thumbnailPath).metadata(),
      readFile(sourcePath),
    ]);
    if (sourceMetadata.format !== 'webp') errors.push(`Template "${id}" source is not WebP.`);
    if (thumbnailMetadata.format !== 'webp') errors.push(`Template "${id}" thumbnail is not WebP.`);
    if (
      sourceMetadata.width !== metadata.image.width ||
      sourceMetadata.height !== metadata.image.height
    ) {
      errors.push(`Template "${id}" image dimensions do not match its metadata.`);
    }
    if (
      Math.max(sourceMetadata.width ?? 0, sourceMetadata.height ?? 0) >
      templateImageConfig.maxSourceEdge
    ) {
      errors.push(`Template "${id}" source exceeds the configured maximum edge.`);
    }
    if (
      Math.max(thumbnailMetadata.width ?? 0, thumbnailMetadata.height ?? 0) >
      templateImageConfig.thumbnailEdge
    ) {
      errors.push(`Template "${id}" thumbnail exceeds the configured maximum edge.`);
    }

    const hash = hashBuffer(source);
    const duplicateId = sourceHashes.get(hash);
    if (duplicateId) errors.push(`Templates "${duplicateId}" and "${id}" have duplicate sources.`);
    sourceHashes.set(hash, id);
  } catch (error) {
    errors.push(formatError(error));
  }
}

async function processTemplateImage(imageInput: TemplateImageInput): Promise<{
  source: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}> {
  const sharpInput = typeof imageInput === 'string' ? path.resolve(imageInput) : imageInput;
  const inputMetadata = await sharp(sharpInput, { failOn: 'warning' }).metadata();
  if (!inputMetadata.format || !SUPPORTED_INPUT_FORMATS.has(inputMetadata.format)) {
    throw new Error('Template images must be PNG, JPEG, WebP, or AVIF raster files.');
  }
  if ((inputMetadata.pages ?? 1) > 1) {
    throw new Error('Animated template images are not supported.');
  }

  const source = await sharp(sharpInput, { failOn: 'warning' })
    .rotate()
    .resize({
      width: templateImageConfig.maxSourceEdge,
      height: templateImageConfig.maxSourceEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      alphaQuality: 100,
      quality: templateImageConfig.sourceWebpQuality,
      smartSubsample: true,
    })
    .toBuffer();
  const normalizedMetadata = await sharp(source).metadata();
  const { width, height } = normalizedMetadata;
  if (!width || !height) throw new Error('Could not determine normalized image dimensions.');

  const thumbnail = await sharp(source)
    .resize({
      width: templateImageConfig.thumbnailEdge,
      height: templateImageConfig.thumbnailEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: templateImageConfig.thumbnailWebpQuality, smartSubsample: true })
    .toBuffer();

  return { source, thumbnail, width, height };
}

async function assertUniqueSourceImage(templatesPath: string, source: Buffer): Promise<void> {
  const targetHash = hashBuffer(source);
  const entries = await readDirectoryOrEmpty(templatesPath);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.tmp-')) continue;
    const existingPath = path.join(templatesPath, entry.name, 'source.webp');
    try {
      const existing = await readFile(existingPath);
      if (hashBuffer(existing) === targetHash) {
        throw new Error(`This image is already used by template "${entry.name}".`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function assertUniqueImgflipReference(
  templatesPath: string,
  references: readonly CatalogReference[],
): Promise<void> {
  const candidate = references.find((reference) => reference.kind === 'imgflip-template');
  if (!candidate) return;

  const entries = await readDirectoryOrEmpty(templatesPath);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.tmp-')) continue;
    const metadataPath = path.join(templatesPath, entry.name, 'template.json');
    try {
      const metadata = await parseJsonFile(metadataPath, memeTemplateMetadataSchema);
      const duplicate = metadata.references.some(
        (reference) =>
          reference.kind === 'imgflip-template' && reference.templateId === candidate.templateId,
      );
      if (duplicate) {
        throw new Error(
          `Imgflip template ID "${candidate.templateId}" is already used by template "${entry.name}".`,
        );
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

function canonicalizeGroup(draft: GroupDraft): TemplateGroup {
  return templateGroupSchema.parse({
    id: slugify(draft.id),
    kind: draft.kind,
    name: draft.name.trim(),
    aliases: normalizeStringList(draft.aliases),
    references: [...draft.references].map(normalizeReference).sort(compareReferences),
  });
}

function canonicalizeTemplate(
  draft: TemplateDraft & { image: MemeTemplateMetadata['image'] },
): MemeTemplateMetadata {
  return memeTemplateMetadataSchema.parse({
    id: slugify(draft.id),
    title: draft.title.trim(),
    aliases: normalizeStringList(draft.aliases),
    tags: normalizeStringList(draft.tags.map(slugify)).filter(Boolean),
    groupIds: normalizeStringList(draft.groupIds),
    references: [...draft.references].map(normalizeReference).sort(compareReferences),
    image: draft.image,
  });
}

function normalizeReference(reference: CatalogReference): CatalogReference {
  if (reference.kind === 'imgflip-template') return createImgflipReference(reference.url);
  return { ...reference, url: normalizeReferenceUrl(reference.kind, reference.url) };
}

function normalizeReferenceUrl(
  kind: Exclude<CatalogReference['kind'], 'imgflip-template'>,
  rawUrl: string,
): string {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== 'https:') throw new Error('Reference URLs must use HTTPS.');
  if (url.username || url.password) throw new Error('Reference URLs cannot contain credentials.');
  if (kind === 'know-your-meme') {
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'knowyourmeme.com' && hostname !== 'www.knowyourmeme.com') {
      throw new Error('Know Your Meme references must use knowyourmeme.com.');
    }
    url.host = 'knowyourmeme.com';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  }
  return url.toString();
}

function compareReferences(left: CatalogReference, right: CatalogReference): number {
  return left.kind.localeCompare(right.kind) || left.url.localeCompare(right.url);
}

async function parseJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  return parseJson(await readFile(filePath, 'utf8'), schema, filePath);
}

function parseJson<T>(raw: string, schema: z.ZodType<T>, source: string): T {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${source}.`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'record'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid catalog record ${source}: ${issues}`);
  }
  return result.data;
}

async function readDirectoryOrEmpty(directory: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function assertPathMissing(target: string, message: string): Promise<void> {
  try {
    await access(target);
    throw new Error(message);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

async function stringifyRecord(record: TemplateGroup | MemeTemplateMetadata): Promise<string> {
  return format(JSON.stringify(record), { parser: 'json', printWidth: 100 });
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
