import { Minus, Plus } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { NumericInput } from './NumericInput';

interface SliderControlProps {
  id: string;
  label: string;
  unit: 'px' | '%' | '°';
  min: number;
  max: number;
  expandRange?: boolean;
  buttonStep?: number;
  preview?: ReactNode;
  descriptionId?: string;
  value: number;
  onChange: (value: number) => void;
  onAdjustmentStart?: () => void;
  onAdjustmentEnd?: () => void;
}

const RANGE_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export const SliderControl = ({
  id,
  label,
  unit,
  min,
  max: defaultMax,
  expandRange = false,
  buttonStep = 1,
  preview,
  descriptionId,
  value,
  onChange,
  onAdjustmentStart,
  onAdjustmentEnd,
}: SliderControlProps) => {
  const isAdjusting = useRef(false);
  const [adjustmentMax, setAdjustmentMax] = useState<number | null>(null);
  const max =
    adjustmentMax ??
    (expandRange ? Math.max(defaultMax, Math.ceil(value / defaultMax) * defaultMax) : defaultMax);
  const unitLabel = unit === 'px' ? 'pixels' : unit === '%' ? 'percent' : 'degrees';
  const finishOnUnmount = useEffectEvent(() => onAdjustmentEnd?.());

  useEffect(
    () => () => {
      if (isAdjusting.current) {
        isAdjusting.current = false;
        finishOnUnmount();
      }
    },
    [],
  );

  const beginAdjustment = () => {
    if (isAdjusting.current) return;
    isAdjusting.current = true;
    setAdjustmentMax(max);
    onAdjustmentStart?.();
  };

  const endAdjustment = () => {
    if (!isAdjusting.current) return;
    isAdjusting.current = false;
    setAdjustmentMax(null);
    onAdjustmentEnd?.();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(Math.max(min, Math.round(value) - buttonStep))}
            disabled={value <= min}
            aria-label={`Decrease ${label.toLowerCase()}`}
            className="flex h-11 w-11 items-center justify-center border border-border bg-canvas/50 text-content-secondary disabled:opacity-40 md:hidden"
          >
            <Minus size={18} />
          </button>
          <NumericInput
            id={id}
            aria-label={`${label} in ${unitLabel}`}
            aria-describedby={descriptionId}
            min={min}
            max={expandRange ? undefined : defaultMax}
            value={value}
            onCommit={onChange}
            className="field-input w-20 text-right tabular-nums"
          />
          <span className="text-xs text-content-muted" aria-hidden="true">
            {unit}
          </span>
          <button
            type="button"
            onClick={() =>
              onChange(
                Math.min(expandRange ? Infinity : defaultMax, Math.round(value) + buttonStep),
              )
            }
            disabled={!expandRange && value >= defaultMax}
            aria-label={`Increase ${label.toLowerCase()}`}
            className="flex h-11 w-11 items-center justify-center border border-border bg-canvas/50 text-content-secondary disabled:opacity-40 md:hidden"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          id={`${id}-slider`}
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.round(value)}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            beginAdjustment();
          }}
          onPointerUp={endAdjustment}
          onPointerCancel={endAdjustment}
          onLostPointerCapture={endAdjustment}
          onKeyDown={(event) => {
            if (RANGE_KEYS.has(event.key)) beginAdjustment();
          }}
          onKeyUp={(event) => {
            if (RANGE_KEYS.has(event.key)) endAdjustment();
          }}
          onBlur={endAdjustment}
          aria-label={`Adjust ${label.toLowerCase()}`}
          aria-describedby={descriptionId}
          aria-valuetext={`${Math.round(value)} ${unitLabel}`}
          className="block h-11 min-w-0 flex-1 touch-none accent-accent md:pointer-fine:h-6"
        />
        {preview}
      </div>
    </div>
  );
};
