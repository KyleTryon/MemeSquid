import { Pipette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
}

type EyeDropperConstructor = new () => EyeDropperInstance;

interface EyeDropperWindow extends Window {
  EyeDropper?: EyeDropperConstructor;
}

interface ColorPickerProps {
  id?: string;
  value: string;
  onChange: (color: string) => void;
  ariaLabel: string;
  className?: string;
}

const FULL_HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SHORT_HEX_COLOR = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

const normalizeHexColor = (value: string): string | null => {
  const prefixedValue = value.startsWith('#') ? value : `#${value}`;
  if (FULL_HEX_COLOR.test(prefixedValue)) return prefixedValue.toLowerCase();

  const shortColor = SHORT_HEX_COLOR.exec(prefixedValue);
  if (!shortColor) return null;

  const [, red, green, blue] = shortColor;
  return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
};

const getEyeDropper = (): EyeDropperConstructor | undefined =>
  typeof window === 'undefined' ? undefined : (window as EyeDropperWindow).EyeDropper;

export const ColorPicker = ({
  id,
  value,
  onChange,
  ariaLabel,
  className = '',
}: ColorPickerProps) => {
  const [draftValue, setDraftValue] = useState(value.toUpperCase());
  const [isEditing, setIsEditing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const eyeDropperAbortController = useRef<AbortController | null>(null);
  const isCancellingEdit = useRef(false);
  const EyeDropper = getEyeDropper();

  useEffect(
    () => () => {
      eyeDropperAbortController.current?.abort();
    },
    [],
  );

  const commitDraftValue = () => {
    if (isCancellingEdit.current) {
      isCancellingEdit.current = false;
      setDraftValue(value.toUpperCase());
      setIsEditing(false);
      return;
    }

    const normalizedColor = normalizeHexColor(draftValue);
    if (normalizedColor) {
      onChange(normalizedColor);
      setDraftValue(normalizedColor.toUpperCase());
    } else {
      setDraftValue(value.toUpperCase());
    }
    setIsEditing(false);
  };

  const pickScreenColor = async () => {
    if (!EyeDropper || isPicking) return;

    const abortController = new AbortController();
    eyeDropperAbortController.current = abortController;
    setIsPicking(true);

    try {
      const result = await new EyeDropper().open({ signal: abortController.signal });
      const normalizedColor = normalizeHexColor(result.sRGBHex);
      if (normalizedColor) onChange(normalizedColor);
    } catch {
      // Escape and clicking outside the sampler are normal cancellation paths.
    } finally {
      eyeDropperAbortController.current = null;
      setIsPicking(false);
    }
  };

  return (
    <div
      className={`flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl border border-border bg-canvas/50 p-1 transition-colors focus-within:border-accent-hover hover:border-border-emphasis ${className}`}
    >
      <label
        className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-lg canvas-transparency-grid shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]"
        title={`Open ${ariaLabel.toLowerCase()} picker`}
      >
        <span
          aria-hidden="true"
          className="absolute inset-[3px] rounded-[0.35rem] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.2)]"
          style={{ backgroundColor: value }}
        />
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={ariaLabel}
        />
      </label>

      <input
        type="text"
        value={isEditing ? draftValue : value.toUpperCase()}
        onFocus={() => {
          setDraftValue(value.toUpperCase());
          setIsEditing(true);
        }}
        onChange={(event) => {
          const nextValue = event.target.value.toUpperCase().slice(0, 7);
          setDraftValue(nextValue);
          const normalizedColor = normalizeHexColor(nextValue);
          if (normalizedColor && nextValue.length === 7) onChange(normalizedColor);
        }}
        onBlur={commitDraftValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            isCancellingEdit.current = true;
            setDraftValue(value.toUpperCase());
            event.currentTarget.blur();
          }
        }}
        className="color-picker-value h-9 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs uppercase text-content-secondary outline-none"
        aria-label={`${ariaLabel} hex value`}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
      />

      {EyeDropper && (
        <button
          type="button"
          onClick={() => void pickScreenColor()}
          disabled={isPicking}
          className="color-picker-button flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface hover:text-accent-hover disabled:opacity-60"
          aria-label={`Pick ${ariaLabel.toLowerCase()} from screen`}
          title="Pick a color from anywhere on screen"
        >
          <Pipette size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
