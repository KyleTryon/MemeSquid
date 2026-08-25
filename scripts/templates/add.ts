import path from 'node:path';
import { parseArgs } from 'node:util';
import { templateGroupKinds, type TemplateGroup } from '../../src/templateCatalog/schemas.ts';
import {
  addTemplate,
  createReferences,
  normalizeStringList,
  parseImgflipTemplateInput,
  readGroups,
  slugify,
  type TemplateImageInput,
} from './catalogFiles.ts';
import {
  formatBytes,
  getCliArgs,
  parseCommaSeparated,
  printFailure,
  prompts,
  unwrapPrompt,
  validateReference,
  validateRequired,
  validateSlug,
} from './cli.ts';
import { resolveImgflipTemplate, type ResolvedImgflipTemplate } from './imgflip.ts';
import { projectRoot } from './project.ts';

const { values } = parseArgs({
  args: getCliArgs(),
  allowPositionals: false,
  strict: true,
  options: {
    alias: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
    group: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    image: { type: 'string', short: 'i' },
    imgflip: { type: 'string' },
    kym: { type: 'string' },
    source: { type: 'string' },
    tag: { type: 'string', multiple: true },
    title: { type: 'string', short: 't' },
    yes: { type: 'boolean', short: 'y', default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm template:add [options]

Run without arguments for an interactive form.

Options:
  -i, --image <path>      Local PNG, JPEG, WebP, or AVIF image
      --imgflip <id|url>  Import or identify an Imgflip template
  -t, --title <title>     Template display title
      --id <slug>         Stable ID; defaults to a slug of the title
      --alias <name>      Search alias; repeatable
      --tag <tag>         Search tag; repeatable
      --group <id>        Group ID; repeatable
      --kym <url>         Optional template-specific Know Your Meme reference
      --source <url>      Optional original-source reference
      --dry-run           Process, validate, and preview without writing
  -y, --yes               Do not prompt or ask for confirmation
  -h, --help              Show this help

Group kinds are defined when groups are created: series, property, artist`);
} else {
  await main().catch(printFailure);
}

async function main(): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !values.yes);
  if (!interactive && !values.yes && !values['dry-run']) {
    throw new Error('Non-interactive template imports require --yes before writing files.');
  }
  if (interactive) prompts.intro('Add a meme template');

  let localImageInput = values.image?.trim();
  let imgflipInput = values.imgflip?.trim();
  if (interactive && !localImageInput && !imgflipInput) {
    const sourceKind = unwrapPrompt(
      await prompts.select<'imgflip' | 'local'>({
        message: 'Where should the template image come from?',
        options: [
          {
            value: 'imgflip',
            label: 'Imgflip template',
            hint: 'Paste a template URL or ID',
          },
          { value: 'local', label: 'Local image', hint: 'PNG, JPEG, WebP, or AVIF' },
        ],
        initialValue: 'imgflip',
      }),
    );
    if (sourceKind === 'imgflip') imgflipInput = await promptImgflip(true);
    else localImageInput = await promptImage();
  }
  if (interactive && localImageInput && !imgflipInput) {
    imgflipInput = await promptImgflip(false);
  }
  if (!localImageInput && !imgflipInput) {
    throw new Error('--image or --imgflip is required when prompts are disabled.');
  }

  const parsedImgflip = imgflipInput ? parseImgflipTemplateInput(imgflipInput) : undefined;
  let imgflipReference = parsedImgflip?.type === 'reference' ? parsedImgflip.reference : undefined;
  let resolvedImgflip: ResolvedImgflipTemplate | undefined;
  if (
    parsedImgflip &&
    (parsedImgflip.type === 'slug' || !localImageInput || !values.title?.trim())
  ) {
    const spinner = interactive ? prompts.spinner() : undefined;
    const identifier =
      parsedImgflip.type === 'reference' ? parsedImgflip.reference.templateId : parsedImgflip.slug;
    spinner?.start(`Resolving Imgflip template ${identifier}`);
    try {
      resolvedImgflip = await resolveImgflipTemplate(parsedImgflip);
      imgflipReference = resolvedImgflip.reference;
      spinner?.stop('Imgflip template resolved');
    } catch (error) {
      spinner?.stop('Imgflip template could not be resolved automatically');
      if (!interactive || parsedImgflip.type === 'slug') throw error;
      prompts.log.warn(error instanceof Error ? error.message : String(error));
      if (!localImageInput) localImageInput = await promptImage();
    }
  }

  const localImagePath = localImageInput ? path.resolve(process.cwd(), localImageInput) : undefined;
  const imageSource: TemplateImageInput = localImagePath ?? requireResolvedImage(resolvedImgflip);
  const imageLabel = localImagePath
    ? path.relative(projectRoot, localImagePath) || path.basename(localImagePath)
    : `Imgflip ${imgflipReference?.templateId ?? ''} (${resolvedImgflip?.imageUrl ?? ''})`;

  const title =
    values.title?.trim() ||
    (interactive ? await promptTitle(resolvedImgflip?.title) : (resolvedImgflip?.title ?? ''));
  if (!title) throw new Error('--title is required when prompts are disabled.');

  const suggestedId = slugify(title);
  const id = values.id?.trim() || (interactive ? await promptId(suggestedId) : suggestedId);
  const aliases = values.alias ?? (interactive ? await promptList('Aliases', []) : []);
  const tags = values.tag ?? (interactive ? await promptList('Search tags', []) : []);
  const providedGroupIds = normalizeStringList(values.group ?? []);
  const groupIds = interactive ? await promptGroupIds(providedGroupIds) : providedGroupIds;
  const knowYourMemeUrl =
    values.kym ??
    (interactive
      ? await promptOptionalUrl('Template-specific Know Your Meme URL', 'know-your-meme')
      : undefined);
  const sourceUrl =
    values.source ??
    (interactive ? await promptOptionalUrl('Original source URL', 'source') : undefined);
  const references = createReferences({
    imgflipTemplate: imgflipReference?.url,
    knowYourMemeUrl,
    sourceUrl,
  });

  if (interactive) {
    prompts.note(
      [
        `Image: ${imageLabel}`,
        `Title: ${title}`,
        `ID: ${id}`,
        `Aliases: ${aliases.length ? aliases.join(', ') : 'None'}`,
        `Tags: ${tags.length ? tags.join(', ') : 'None'}`,
        `Groups: ${groupIds.length ? groupIds.join(', ') : 'None'}`,
        `References: ${references.length || 'None'}`,
      ].join('\n'),
      values['dry-run'] ? 'Dry-run summary' : 'Template summary',
    );
    const confirmed = unwrapPrompt(
      await prompts.confirm({ message: 'Process and add this template?', initialValue: true }),
    );
    if (!confirmed) {
      prompts.cancel('No catalog changes were made.');
      return;
    }
  }

  const spinner = interactive ? prompts.spinner() : undefined;
  spinner?.start(values['dry-run'] ? 'Processing and validating image' : 'Adding template');
  const result = await addTemplate(
    projectRoot,
    imageSource,
    { id, title, aliases, tags, groupIds, references },
    { dryRun: values['dry-run'] },
  );
  spinner?.stop(values['dry-run'] ? 'Template is valid' : 'Template added');

  const message = [
    `${result.metadata.title} (${result.metadata.id})${values['dry-run'] ? ' would be added' : ' added'}.`,
    `${result.metadata.image.width}×${result.metadata.image.height}`,
    `source ${formatBytes(result.sourceBytes)}`,
    `thumbnail ${formatBytes(result.thumbnailBytes)}`,
  ].join(' · ');
  if (interactive) prompts.outro(message);
  else console.log(message);
}

async function promptImage(): Promise<string> {
  return unwrapPrompt(
    await prompts.text({
      message: 'Path to the template image',
      placeholder: './incoming/template.png',
      validate: validateRequired,
    }),
  );
}

async function promptTitle(initialValue?: string): Promise<string> {
  return unwrapPrompt(
    await prompts.text({
      message: 'Template title',
      initialValue,
      validate: validateRequired,
    }),
  );
}

async function promptImgflip(required: boolean): Promise<string | undefined> {
  const value = unwrapPrompt(
    await prompts.text({
      message: required ? 'Imgflip template URL or ID' : 'Imgflip template URL or ID (optional)',
      placeholder: required ? '516512053 or https://imgflip.com/memetemplate/…' : 'Optional',
      validate: (input) => {
        if (required && !input?.trim()) return 'An Imgflip template URL or ID is required.';
        return validateReference('imgflip-template', input);
      },
    }),
  ).trim();
  return value || undefined;
}

async function promptId(suggestedId: string): Promise<string> {
  return unwrapPrompt(
    await prompts.text({
      message: 'Stable template ID',
      initialValue: suggestedId,
      validate: validateSlug,
    }),
  );
}

async function promptList(label: string, initial: readonly string[]): Promise<string[]> {
  const value = unwrapPrompt(
    await prompts.text({
      message: `${label} (comma-separated)`,
      initialValue: initial.join(', '),
      placeholder: 'Leave blank for none',
    }),
  );
  return parseCommaSeparated(value);
}

async function promptGroupIds(initial: readonly string[]): Promise<string[]> {
  const groups = await readGroups(projectRoot);
  const groupIds = new Set(groups.map(({ id }) => id));
  for (const groupId of initial) {
    if (!groupIds.has(groupId)) {
      throw new Error(`Unknown group "${groupId}". Add it with pnpm template:group:add first.`);
    }
  }
  if (!groups.length) {
    prompts.log.warn('No groups exist yet. Add them later with pnpm template:group:add.');
    return [];
  }

  const selected = unwrapPrompt(
    await prompts.multiselect<string>({
      message: 'Select groups',
      options: sortGroupsByKind(groups).map((group) => ({
        value: group.id,
        label: group.name,
        hint: [group.kind, ...group.aliases].join(' · '),
      })),
      initialValues: [...initial],
      required: false,
    }),
  );
  return normalizeStringList(selected);
}

function sortGroupsByKind(groups: readonly TemplateGroup[]): TemplateGroup[] {
  const kindOrder = new Map(templateGroupKinds.map((kind, index) => [kind, index]));
  return [...groups].sort(
    (left, right) =>
      (kindOrder.get(left.kind) ?? 0) - (kindOrder.get(right.kind) ?? 0) ||
      left.name.localeCompare(right.name),
  );
}

async function promptOptionalUrl(
  label: string,
  kind: 'know-your-meme' | 'source',
): Promise<string | undefined> {
  const value = unwrapPrompt(
    await prompts.text({
      message: label,
      placeholder: 'Optional',
      validate: (input) => validateReference(kind, input),
    }),
  ).trim();
  return value || undefined;
}

function requireResolvedImage(resolved: ResolvedImgflipTemplate | undefined): Buffer {
  if (!resolved) throw new Error('Imgflip template image could not be resolved.');
  return resolved.image;
}
