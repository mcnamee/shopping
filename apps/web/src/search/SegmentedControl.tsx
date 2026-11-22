import { Check } from 'lucide-react';
import { useRef } from 'react';

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** `primary` (custom sheet, accent fill) or `quiet` (quantity modal unit override). */
  variant?: 'primary' | 'quiet';
  optionLabel?: (value: T) => string;
  describedBy?: string;
  /** Grid columns (default 6, the unit control). */
  columns?: 2 | 3 | 6;
  /** Accessible names that differ from the visible label. */
  ariaLabels?: Partial<Record<T, string>>;
}

/**
 * Single-select segmented radiogroup with roving tabindex and arrow keys.
 * Selected state is never colour alone: a check icon (primary) or thicker border (quiet).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  variant = 'primary',
  optionLabel = (v) => v,
  describedBy,
  columns = 6,
  ariaLabels,
}: SegmentedControlProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    const target = options[next] as T;
    onChange(target);
    refs.current.get(target)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      className={`grid gap-1 ${
        columns === 2 ? 'grid-cols-2' : columns === 3 ? 'grid-cols-3' : 'grid-cols-6'
      }`}
    >
      {options.map((opt, i) => {
        const selected = opt === value;
        const style =
          variant === 'primary'
            ? selected
              ? 'border-accent bg-accent text-accent-on'
              : 'border-border bg-surface text-text'
            : selected
              ? 'border-accent border-2 bg-accent-soft text-accent font-bold'
              : 'border-border border bg-surface text-text';
        return (
          <button
            key={opt}
            ref={(el) => {
              if (el) refs.current.set(opt, el);
              else refs.current.delete(opt);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            {...(ariaLabels?.[opt] ? { 'aria-label': ariaLabels[opt] } : {})}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex min-h-tap min-w-0 items-center justify-center gap-0.5 rounded-sm text-sm font-semibold ${
              variant === 'primary' ? 'border-2' : ''
            } ${style}`}
          >
            {variant === 'primary' && selected && (
              <Check aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
            )}
            <span className="truncate">{optionLabel(opt)}</span>
          </button>
        );
      })}
    </div>
  );
}
