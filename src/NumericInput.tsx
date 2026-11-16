import { useRef, useState, type ComponentProps } from 'react';

interface NumericInputProps extends Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown' | 'min' | 'max' | 'step'
> {
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}

export const NumericInput = ({ value, min, max, onCommit, ...props }: NumericInputProps) => {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelEdit = useRef(false);

  const commit = () => {
    const canceled = cancelEdit.current;
    cancelEdit.current = false;
    setDraft(null);
    if (canceled || draft === null || !draft.trim()) return;

    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(parsed)));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      {...props}
      type="number"
      step={1}
      min={min}
      max={max}
      value={draft ?? Math.round(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancelEdit.current = event.key === 'Escape';
        event.currentTarget.blur();
      }}
    />
  );
};
