import path from 'node:path';
import { parseArgs } from 'node:util';
import { updateTemplateImage, type TemplateImageInput } from './catalogFiles.ts';
import {
  formatBytes,
  getCliArgs,
  printFailure,
  prompts,
  unwrapPrompt,
  validateRequired,
  validateSlug,
} from './cli.ts';
import { projectRoot } from './project.ts';
import { downloadRemoteImage } from './remoteImage.ts';

const { values } = parseArgs({
  args: getCliArgs(),
  allowPositionals: false,
  strict: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    image: { type: 'string', short: 'i' },
    yes: { type: 'boolean', short: 'y', default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm template:image:update [options]

Replace an existing template image and regenerate its normalized WebP assets.

Options:
      --id <slug>         Existing template ID
  -i, --image <path|url>  Local PNG, JPEG, WebP, or AVIF path, or HTTPS URL
      --dry-run           Download, process, and validate without writing
  -y, --yes               Do not prompt or ask for confirmation
  -h, --help              Show this help`);
} else {
  await main().catch(printFailure);
}

async function main(): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !values.yes);
  if (!interactive && !values.yes && !values['dry-run']) {
    throw new Error('Non-interactive image replacements require --yes before writing files.');
  }
  if (interactive) prompts.intro('Replace a meme template image');

  const id =
    values.id?.trim() ||
    (interactive
      ? unwrapPrompt(
          await prompts.text({
            message: 'Existing template ID',
            placeholder: 'boardroom-meeting-suggestion',
            validate: validateSlug,
          }),
        )
      : '');
  if (!id) throw new Error('--id is required when prompts are disabled.');

  const rawImage =
    values.image?.trim() ||
    (interactive
      ? unwrapPrompt(
          await prompts.text({
            message: 'Replacement image path or HTTPS URL',
            placeholder: './incoming/template.png',
            validate: validateRequired,
          }),
        ).trim()
      : '');
  if (!rawImage) throw new Error('--image is required when prompts are disabled.');

  if (interactive) {
    prompts.note(
      [`Template: ${id}`, `Replacement: ${rawImage}`].join('\n'),
      values['dry-run'] ? 'Dry-run summary' : 'Replacement summary',
    );
    const confirmed = unwrapPrompt(
      await prompts.confirm({
        message: values['dry-run']
          ? 'Process and validate this replacement?'
          : 'Replace this template image?',
        initialValue: true,
      }),
    );
    if (!confirmed) {
      prompts.cancel('No catalog changes were made.');
      return;
    }
  }

  const spinner = interactive ? prompts.spinner() : undefined;
  spinner?.start(values['dry-run'] ? 'Validating replacement image' : 'Replacing template image');
  const imageInput = await resolveImageInput(rawImage);
  const result = await updateTemplateImage(projectRoot, id, imageInput, {
    dryRun: values['dry-run'],
  });
  spinner?.stop(values['dry-run'] ? 'Replacement is valid' : 'Template image replaced');

  const message = [
    `${result.metadata.title} (${result.metadata.id}) image${values['dry-run'] ? ' would be replaced' : ' replaced'}.`,
    `${result.metadata.image.width}×${result.metadata.image.height}`,
    `source ${formatBytes(result.sourceBytes)}`,
    `thumbnail ${formatBytes(result.thumbnailBytes)}`,
  ].join(' · ');
  if (interactive) prompts.outro(message);
  else console.log(message);
}

async function resolveImageInput(rawImage: string): Promise<TemplateImageInput> {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(rawImage)) {
    return (await downloadRemoteImage(rawImage)).image;
  }
  return path.resolve(process.cwd(), rawImage);
}
