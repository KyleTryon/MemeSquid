import { ArrowLeft } from 'lucide-react';
import { CROP_ASPECT_OPTIONS, fitCropToAspectRatio, getCropAspectRatio } from './cropGeometry';
import type { CropAspect, Size } from './cropGeometry';
import type { CropRect } from './types';

interface CropPropertiesProps {
  aspect: CropAspect;
  draft: CropRect;
  source: Size;
  minimumSize: number;
  onAspectChange: (aspect: CropAspect) => void;
  onClose: () => void;
}

export const CropProperties = ({
  aspect,
  draft,
  source,
  minimumSize,
  onAspectChange,
  onClose,
}: CropPropertiesProps) => (
  <section className="space-y-4">
    <h3 className="section-title">Aspect ratio</h3>
    <div className="grid grid-cols-6 gap-2" role="group" aria-label="Crop aspect ratio">
      {CROP_ASPECT_OPTIONS.map((option, index) => {
        const disabled =
          fitCropToAspectRatio(
            draft,
            source,
            getCropAspectRatio(option.value, source),
            minimumSize,
          ) === null;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onAspectChange(option.value)}
            aria-pressed={aspect === option.value}
            disabled={disabled}
            title={disabled ? 'The canvas is too small for this ratio' : undefined}
            className={`${index < 2 ? 'col-span-3' : 'col-span-2'} rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${aspect === option.value ? 'border-accent-hover bg-accent/10 text-accent-hover' : 'border-border bg-canvas/50 text-content-secondary hover:border-border-emphasis'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-3">
      <span className="field-label">Crop size</span>
      <output
        className="text-sm font-semibold tabular-nums text-content"
        aria-label="Crop dimensions in pixels"
      >
        {Math.round(draft.width)} × {Math.round(draft.height)} px
      </output>
    </div>
    <button
      type="button"
      onClick={onClose}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover md:hidden"
    >
      <ArrowLeft size={18} /> Back to crop
    </button>
  </section>
);
