import { ExternalLink, Images, Loader2, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { templateCatalog, type CatalogTemplate } from './templateCatalog/catalog';
import { getTemplateGroups, searchTemplateCatalog } from './templateCatalog/search';
import { templateGroupKinds, type CatalogReference } from './templateCatalog/schemas';
import { useDialogFocus } from './useDialogFocus';

interface TemplateLibraryDialogProps {
  isOpen: boolean;
  loadingTemplateId: string | null;
  onClose: () => void;
  onSelect: (template: CatalogTemplate) => void;
}

const GROUP_KIND_LABELS = {
  artist: 'Artists',
  property: 'Franchises',
} as const;

const AVAILABLE_GROUP_KINDS = templateGroupKinds.filter((kind) =>
  templateCatalog.groups.some((group) => group.kind === kind),
);

export default function TemplateLibraryDialog({
  isOpen,
  loadingTemplateId,
  onClose,
  onSelect,
}: TemplateLibraryDialogProps) {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const dialogRef = useDialogFocus(isOpen, onClose);

  const templates = useMemo(
    () => searchTemplateCatalog(templateCatalog, { groupId, query }),
    [groupId, query],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-overlay/80 p-0 md:items-center md:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loadingTemplateId) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-library-title"
        aria-describedby="template-library-description"
        tabIndex={-1}
        className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl md:h-[min(88dvh,56rem)] md:max-w-6xl md:rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
            <Images size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="template-library-title" className="text-xl font-black text-content-strong">
              Meme templates
            </h2>
            <p id="template-library-description" className="mt-1 text-sm text-content-muted">
              Choose a template to start a new meme.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(loadingTemplateId)}
            aria-label="Close template library"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-surface hover:text-content-strong disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid shrink-0 gap-3 border-b border-border px-4 py-4 md:grid-cols-[minmax(0,1fr)_18rem] md:px-6">
          <label className="relative block">
            <span className="sr-only">Search meme templates</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
            />
            <input
              data-dialog-initial-focus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles, tags, or groups"
              className="h-11 w-full rounded-xl border border-border bg-canvas pl-10 pr-4 text-sm text-content-strong placeholder:text-content-subtle"
            />
          </label>
          <label>
            <span className="sr-only">Filter templates by group</span>
            <select
              value={groupId ?? ''}
              onChange={(event) => setGroupId(event.target.value || null)}
              className="h-11 w-full rounded-xl border border-border bg-canvas px-3 text-sm font-bold text-content-strong"
            >
              <option value="">All groups</option>
              {AVAILABLE_GROUP_KINDS.map((kind) => (
                <optgroup key={kind} label={GROUP_KIND_LABELS[kind]}>
                  {templateCatalog.groups
                    .filter((group) => group.kind === kind)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-content-subtle">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'}
          </p>
          {templates.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isLoading={loadingTemplateId === template.id}
                  isDisabled={Boolean(loadingTemplateId)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
              <Search size={30} className="text-content-subtle" />
              <p className="mt-4 font-extrabold text-content-strong">No templates found</p>
              <p className="mt-1 max-w-sm text-sm text-content-muted">
                Try a title, character, franchise, artist, or broader search.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setGroupId(null);
                }}
                className="mt-4 min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-bold text-content-strong hover:border-accent hover:text-accent-hover"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  isDisabled: boolean;
  isLoading: boolean;
  onSelect: (template: CatalogTemplate) => void;
  template: CatalogTemplate;
}

function TemplateCard({ isDisabled, isLoading, onSelect, template }: TemplateCardProps) {
  const groups = getTemplateGroups(templateCatalog, template);
  const source = getPreferredSource(template.references);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-emphasis">
      <button
        type="button"
        onClick={() => onSelect(template)}
        disabled={isDisabled}
        className="block w-full text-left disabled:cursor-wait disabled:opacity-60"
        aria-label={`Start a new meme with ${template.title}`}
      >
        <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-canvas p-2">
          <img
            src={template.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={template.image.width}
            height={template.image.height}
            className="h-full w-full object-contain"
          />
          {isLoading && (
            <span className="absolute inset-0 flex items-center justify-center bg-overlay/65 text-content-strong">
              <Loader2 size={26} className="animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading template</span>
            </span>
          )}
        </span>
        <span className="block px-3 pb-2 pt-3">
          <span className="line-clamp-2 block text-sm font-extrabold leading-snug text-content-strong">
            {template.title}
          </span>
          {groups.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1">
              {groups.slice(0, 2).map((group) => (
                <span
                  key={group.id}
                  className="rounded-full bg-canvas px-2 py-1 text-[10px] font-bold text-content-muted"
                >
                  {group.name}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {source && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-1.5 border-t border-border px-3 text-[11px] font-bold text-content-subtle hover:text-accent-hover"
        >
          <ExternalLink size={12} /> {getSourceLabel(source)}
        </a>
      )}
    </article>
  );
}

function getPreferredSource(references: readonly CatalogReference[]): CatalogReference | undefined {
  return (
    references.find((reference) => reference.kind === 'source') ??
    references.find((reference) => reference.kind === 'imgflip-template') ??
    references.find((reference) => reference.kind === 'know-your-meme')
  );
}

function getSourceLabel(reference: CatalogReference): string {
  if (reference.kind === 'imgflip-template') return 'Imgflip source';
  if (reference.kind === 'know-your-meme') return 'Know Your Meme';
  return 'Original source';
}
