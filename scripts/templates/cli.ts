import * as prompts from '@clack/prompts';
import type { CatalogReference } from '../../src/templateCatalog/schemas.ts';
import { createReferences, parseImgflipTemplateInput, slugify } from './catalogFiles.ts';

export function getCliArgs(): string[] {
  const args = process.argv.slice(2);
  return args[0] === '--' ? args.slice(1) : args;
}

export function unwrapPrompt<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) {
    prompts.cancel('No catalog changes were made.');
    process.exit(0);
  }
  return value;
}

export function parseCommaSeparated(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function validateRequired(value: string | undefined): string | undefined {
  return value?.trim() ? undefined : 'This field is required.';
}

export function validateSlug(value: string | undefined): string | undefined {
  if (!value?.trim()) return 'An ID is required.';
  return slugify(value) === value ? undefined : 'Use lowercase kebab-case.';
}

export function validateReference(
  kind: CatalogReference['kind'],
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    if (kind === 'know-your-meme') createReferences({ knowYourMemeUrl: value });
    else if (kind === 'imgflip-template') parseImgflipTemplateInput(value);
    else createReferences({ sourceUrl: value });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Enter a valid HTTPS URL.';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function printFailure(error: unknown): void {
  prompts.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export { prompts };
