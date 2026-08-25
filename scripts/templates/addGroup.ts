import { parseArgs } from 'node:util';
import { templateGroupKinds, type TemplateGroupKind } from '../../src/templateCatalog/schemas.ts';
import { addGroup, createReferences, slugify } from './catalogFiles.ts';
import {
  parseCommaSeparated,
  printFailure,
  prompts,
  getCliArgs,
  unwrapPrompt,
  validateReference,
  validateRequired,
  validateSlug,
} from './cli.ts';
import { projectRoot } from './project.ts';

const { values } = parseArgs({
  args: getCliArgs(),
  allowPositionals: false,
  strict: true,
  options: {
    alias: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    kind: { type: 'string' },
    kym: { type: 'string' },
    name: { type: 'string', short: 'n' },
    source: { type: 'string' },
    yes: { type: 'boolean', short: 'y', default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm template:group:add [options]

Options:
  -n, --name <name>       Display name (required without an interactive terminal)
      --kind <kind>       Group kind: property or artist
      --id <slug>         Stable ID; defaults to a slug of the name
      --alias <name>      Search alias; repeatable
      --kym <url>         Optional Know Your Meme reference
      --source <url>      Optional original-source reference
      --dry-run           Validate and preview without writing
  -y, --yes               Do not prompt or ask for confirmation
  -h, --help              Show this help`);
} else {
  await main().catch(printFailure);
}

async function main(): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !values.yes);
  if (interactive) prompts.intro('Add a meme template group');

  const kind = values.kind ? parseGroupKind(values.kind) : interactive ? await promptKind() : null;
  if (!kind) throw new Error('--kind is required when prompts are disabled.');
  const name = values.name?.trim() || (interactive ? await promptName() : '');
  if (!name) throw new Error('--name is required when prompts are disabled.');

  const suggestedId = slugify(name);
  const id = values.id?.trim() || (interactive ? await promptId(suggestedId) : suggestedId);
  const aliases = values.alias ?? (interactive ? await promptList('Aliases', []) : []);
  const knowYourMemeUrl =
    values.kym ??
    (interactive ? await promptOptionalUrl('Know Your Meme URL', 'know-your-meme') : undefined);
  const sourceUrl =
    values.source ??
    (interactive ? await promptOptionalUrl('Original source URL', 'source') : undefined);
  const references = createReferences({ knowYourMemeUrl, sourceUrl });

  if (interactive) {
    prompts.note(
      [
        `Kind: ${kind}`,
        `Name: ${name}`,
        `ID: ${id}`,
        `Aliases: ${aliases.length ? aliases.join(', ') : 'None'}`,
        `References: ${references.length || 'None'}`,
      ].join('\n'),
      values['dry-run'] ? 'Dry-run summary' : 'Group summary',
    );
    const confirmed = unwrapPrompt(
      await prompts.confirm({ message: 'Add this group?', initialValue: true }),
    );
    if (!confirmed) {
      prompts.cancel('No catalog changes were made.');
      return;
    }
  }

  const spinner = interactive ? prompts.spinner() : undefined;
  spinner?.start(values['dry-run'] ? 'Validating group' : 'Writing group');
  const group = await addGroup(
    projectRoot,
    { id, kind, name, aliases, references },
    { dryRun: values['dry-run'] },
  );
  spinner?.stop(values['dry-run'] ? 'Group is valid' : 'Group added');

  const message = `${group.name} (${group.id})${values['dry-run'] ? ' would be added.' : ' added.'}`;
  if (interactive) prompts.outro(message);
  else console.log(message);
}

async function promptKind(): Promise<TemplateGroupKind> {
  return unwrapPrompt(
    await prompts.select<TemplateGroupKind>({
      message: 'Group kind',
      options: templateGroupKinds.map((kind) => ({ value: kind, label: capitalize(kind) })),
    }),
  );
}

function parseGroupKind(value: string): TemplateGroupKind {
  const kind = value.trim();
  if (kind === 'property' || kind === 'artist') return kind;
  throw new Error('--kind must be property or artist.');
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

async function promptName(): Promise<string> {
  return unwrapPrompt(
    await prompts.text({
      message: 'Group name',
      validate: validateRequired,
    }),
  );
}

async function promptId(suggestedId: string): Promise<string> {
  return unwrapPrompt(
    await prompts.text({
      message: 'Stable group ID',
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
