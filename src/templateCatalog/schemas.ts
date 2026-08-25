import { z } from 'zod';

export const templateGroupKinds = ['property', 'artist'] as const;

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase kebab-case.');

const httpsUrlSchema = z.string().superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'URL must use HTTPS.' });
    }
    if (url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'URL cannot contain credentials.' });
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'URL must be valid.' });
  }
});

const knowYourMemeReferenceSchema = z
  .object({
    kind: z.literal('know-your-meme'),
    url: httpsUrlSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    let hostname: string;
    try {
      hostname = new URL(reference.url).hostname.toLowerCase();
    } catch {
      return;
    }
    if (hostname !== 'knowyourmeme.com' && hostname !== 'www.knowyourmeme.com') {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Know Your Meme references must use knowyourmeme.com.',
      });
    }
  });

const sourceReferenceSchema = z
  .object({
    kind: z.literal('source'),
    url: httpsUrlSchema,
  })
  .strict();

const imgflipTemplateReferenceSchema = z
  .object({
    kind: z.literal('imgflip-template'),
    templateId: z.string().regex(/^\d+$/u, 'Imgflip template ID must contain only digits.'),
    url: httpsUrlSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    let url: URL;
    try {
      url = new URL(reference.url);
    } catch {
      return;
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'imgflip.com' && hostname !== 'www.imgflip.com') {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Imgflip template references must use imgflip.com.',
      });
      return;
    }

    const pathTemplateId = /^\/(?:meme|memegenerator|memetemplate)\/(\d+)(?:\/|$)/u.exec(
      url.pathname,
    )?.[1];
    if (pathTemplateId !== reference.templateId) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Imgflip URL and template ID must match.',
      });
    }
  });

const catalogReferenceSchema = z.discriminatedUnion('kind', [
  knowYourMemeReferenceSchema,
  sourceReferenceSchema,
  imgflipTemplateReferenceSchema,
]);

const aliasesSchema = z.array(z.string().trim().min(1));

export const templateGroupSchema = z
  .object({
    id: slugSchema,
    kind: z.enum(templateGroupKinds),
    name: z.string().trim().min(1),
    aliases: aliasesSchema,
    references: z.array(catalogReferenceSchema),
  })
  .strict()
  .superRefine((group, context) => {
    addDuplicateIssues(group.aliases, context, ['aliases']);
    addDuplicateReferenceIssues(group.references, context);
    if (group.references.some(({ kind }) => kind === 'imgflip-template')) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Imgflip template references belong on templates, not groups.',
      });
    }
  });

export const memeTemplateMetadataSchema = z
  .object({
    id: slugSchema,
    title: z.string().trim().min(1),
    aliases: aliasesSchema,
    tags: z.array(slugSchema),
    groupIds: z.array(slugSchema),
    references: z.array(catalogReferenceSchema),
    image: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((template, context) => {
    addDuplicateIssues(template.aliases, context, ['aliases']);
    addDuplicateIssues(template.tags, context, ['tags']);
    addDuplicateIssues(template.groupIds, context, ['groupIds']);
    addDuplicateReferenceIssues(template.references, context);
    if (template.references.filter(({ kind }) => kind === 'imgflip-template').length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'A template can have only one Imgflip template reference.',
      });
    }
  });

export type CatalogReference = z.infer<typeof catalogReferenceSchema>;
export type ImgflipTemplateReference = z.infer<typeof imgflipTemplateReferenceSchema>;
export type MemeTemplateMetadata = z.infer<typeof memeTemplateMetadataSchema>;
export type TemplateGroup = z.infer<typeof templateGroupSchema>;
export type TemplateGroupKind = (typeof templateGroupKinds)[number];

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
): void {
  const normalized = values.map((value) => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: 'custom', path: [...path], message: 'Values must be unique.' });
  }
}

function addDuplicateReferenceIssues(
  references: readonly CatalogReference[],
  context: z.RefinementCtx,
): void {
  addDuplicateIssues(
    references.map((reference) =>
      reference.kind === 'imgflip-template'
        ? `${reference.kind}:${reference.templateId}`
        : `${reference.kind}:${reference.url}`,
    ),
    context,
    ['references'],
  );
}
