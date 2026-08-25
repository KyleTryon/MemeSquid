import type { ImgflipTemplateReference } from '../../src/templateCatalog/schemas.ts';
import { createImgflipReference, type ParsedImgflipTemplateInput } from './catalogFiles.ts';

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const IMGFLIP_PAGE_HOSTS = new Set(['imgflip.com', 'www.imgflip.com']);
const IMGFLIP_IMAGE_HOSTS = new Set(['i.imgflip.com', 'imgflip.com', 'www.imgflip.com']);
const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
};

export type FetchTemplateResource = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ResolvedImgflipTemplate {
  image: Buffer;
  imageUrl: string;
  reference: ImgflipTemplateReference;
  title: string | undefined;
}

export async function resolveImgflipTemplate(
  input: ParsedImgflipTemplateInput,
  fetchResource: FetchTemplateResource = fetch,
): Promise<ResolvedImgflipTemplate> {
  const pageUrl = input.type === 'reference' ? input.reference.url : input.url;
  const pageResponse = await fetchResource(pageUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'MemeSquid template importer',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertSuccessfulResponse(pageResponse, 'Imgflip template page');
  assertAllowedHost(pageResponse.url || pageUrl, IMGFLIP_PAGE_HOSTS, 'Imgflip page');
  assertContentLength(pageResponse, MAX_PAGE_BYTES, 'Imgflip template page');

  const html = await pageResponse.text();
  if (Buffer.byteLength(html, 'utf8') > MAX_PAGE_BYTES) {
    throw new Error('Imgflip template page exceeded the 2 MiB import limit.');
  }

  const reference = resolveReference(input, html);
  const imageUrl = extractImageUrl(html, pageUrl);
  const imageResponse = await fetchResource(imageUrl, {
    headers: {
      accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      'user-agent': 'MemeSquid template importer',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assertSuccessfulResponse(imageResponse, 'Imgflip template image');
  assertAllowedHost(imageResponse.url || imageUrl, IMGFLIP_IMAGE_HOSTS, 'Imgflip image');
  assertContentLength(imageResponse, MAX_IMAGE_BYTES, 'Imgflip template image');

  const contentType = imageResponse.headers.get('content-type')?.toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Imgflip image returned an unexpected content type: ${contentType}.`);
  }

  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (!image.byteLength || image.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Imgflip template image was empty or exceeded the 25 MiB import limit.');
  }

  return {
    image,
    imageUrl,
    reference,
    title: extractTitle(html),
  };
}

function resolveReference(
  input: ParsedImgflipTemplateInput,
  html: string,
): ImgflipTemplateReference {
  const detectedTemplateId = /\bTemplate\s+ID:\s*(\d+)\b/iu.exec(html)?.[1];
  if (input.type === 'reference') {
    if (detectedTemplateId && detectedTemplateId !== input.reference.templateId) {
      throw new Error(
        `Imgflip page template ID ${detectedTemplateId} does not match ${input.reference.templateId}.`,
      );
    }
    return input.reference;
  }
  if (!detectedTemplateId) {
    throw new Error('Could not determine the numeric template ID from the Imgflip page.');
  }
  return createImgflipReference(
    `https://imgflip.com/memetemplate/${detectedTemplateId}/${input.slug}`,
  );
}

function extractImageUrl(html: string, pageUrl: string): string {
  const metaImage = findMetaContent(html, 'og:image') ?? findMetaContent(html, 'twitter:image');
  if (metaImage) return normalizeImageUrl(metaImage, pageUrl);

  const imageTags = html.match(/<img\b[^>]*>/giu) ?? [];
  const candidates = imageTags.map(parseAttributes).filter((attributes) => {
    const identity = `${attributes.id ?? ''} ${attributes.class ?? ''}`.toLowerCase();
    return /(?:base|main|meme|mtm|template)[-_ ]?img/u.test(identity);
  });
  for (const attributes of candidates) {
    const source = attributes.src ?? attributes['data-src'];
    if (source) return normalizeImageUrl(source, pageUrl);
  }

  const directImage = /(?:https?:)?\/\/i\.imgflip\.com\/[a-z0-9_./?=&%+-]+/iu.exec(html)?.[0];
  if (directImage) return normalizeImageUrl(directImage, pageUrl);
  throw new Error('Could not find the blank image on the Imgflip template page.');
}

function extractTitle(html: string): string | undefined {
  const rawTitle =
    findMetaContent(html, 'og:title') ?? /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  if (!rawTitle) return undefined;

  const title = decodeHtml(rawTitle)
    .replace(/\s+Blank (?:Meme )?Template\s*(?:-\s*Imgflip)?\s*$/iu, '')
    .replace(/\s+-\s+Imgflip\s*$/iu, '')
    .trim();
  return title || undefined;
}

function findMetaContent(html: string, key: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/giu) ?? [];
  for (const tag of metaTags) {
    const attributes = parseAttributes(tag);
    const attributeKey = (attributes.property ?? attributes.name)?.toLowerCase();
    if (attributeKey === key) return attributes.content;
  }
  return undefined;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attributes[name] = decodeHtml(value);
  }
  return attributes;
}

function normalizeImageUrl(rawUrl: string, pageUrl: string): string {
  const url = new URL(rawUrl, pageUrl);
  if (url.protocol !== 'https:') throw new Error('Imgflip image URL must use HTTPS.');
  assertAllowedHost(url.toString(), IMGFLIP_IMAGE_HOSTS, 'Imgflip image');
  return url.toString();
}

function decodeHtml(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|apos|gt|lt|quot);/giu,
    (entity, decimal, hex) => {
      if (typeof decimal === 'string') return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (typeof hex === 'string') return String.fromCodePoint(Number.parseInt(hex, 16));
      return HTML_NAMED_ENTITIES[entity.toLowerCase()] ?? entity;
    },
  );
}

function assertSuccessfulResponse(response: Response, resource: string): void {
  if (!response.ok) throw new Error(`${resource} returned HTTP ${response.status}.`);
}

function assertAllowedHost(rawUrl: string, hosts: ReadonlySet<string>, resource: string): void {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname.toLowerCase())) {
    throw new Error(`${resource} redirected to an unsupported host.`);
  }
}

function assertContentLength(response: Response, maximum: number, resource: string): void {
  const rawLength = response.headers.get('content-length');
  if (!rawLength) return;
  const length = Number(rawLength);
  if (!Number.isFinite(length) || length < 0 || length > maximum) {
    throw new Error(`${resource} exceeded its import size limit.`);
  }
}
