import {
  announceQuantity,
  convertQuantity,
  formatQuantityNumber,
  isCountUnit,
  isWholeUnit,
  NOTE_MAX_LENGTH,
  parseQuantity,
  presetLabel,
  quantityRules,
  sanitiseQuantityInput,
  stepQuantity,
  UNIT_TYPES,
  unitWord,
  type ProductSummary,
  type UnitType,
} from '@trolley/core';
import { Check, CircleAlert, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { ProductImage } from './ProductImage';
import { SegmentedControl } from './SegmentedControl';

export interface QuantitySelection {
  product: ProductSummary;
  quantity: number;
  unit: UnitType;
  note: string;
}

interface QuantityModalProps {
  product: ProductSummary;
  onConfirm: (selection: QuantitySelection) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 125; // 8 steps per second

/**
 * Quantity bottom sheet (docs/ux/quantity-modal.md). Opens at the default for the product's
 * unit type; stepper, presets, typed entry with validation, unit override (converts within
 * kg/g and L/mL), optional note. Confirm hands the selection to the parent; Stage 1
 * persists nothing (D-026).
 */
export function QuantityModal({ product, onConfirm, onClose, returnFocusRef }: QuantityModalProps) {
  const headingId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [unit, setUnit] = useState<UnitType>(product.unitType);
  const [value, setValue] = useState(() => quantityRules(product.unitType).default);
  const [text, setText] = useState(() =>
    formatQuantityNumber(quantityRules(product.unitType).default, product.unitType),
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [compact, setCompact] = useState(false);

  const rules = quantityRules(unit);
  const counted = isCountUnit(unit);
  const whole = isWholeUnit(unit);

  const announce = (msg: string) => setAnnouncement(msg);

  /** Current numeric value: the typed text if it parses, else the last valid value. */
  const current = () => {
    const parsed = parseQuantity(text, unit);
    return parsed.ok ? parsed.value : value;
  };

  const apply = (next: number, say = true) => {
    setValue(next);
    setText(formatQuantityNumber(next, unit));
    setError(null);
    if (say) announce(announceQuantity(next, unit));
  };

  const canStep = (dir: 1 | -1) => stepQuantity(current(), unit, dir) !== null;

  // Hold-to-repeat. Pointer press steps immediately, then repeats after 400 ms.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef({ unit, current });
  live.current = { unit, current };
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimer.current = null;
    holdInterval.current = null;
  }, []);
  useEffect(() => stopHold, [stopHold]);

  const step = (dir: 1 | -1) => {
    const { unit: u, current: cur } = live.current;
    const next = stepQuantity(cur(), u, dir);
    if (next === null) {
      stopHold();
      announce(dir === 1 ? 'Maximum reached' : 'Minimum reached');
      return false;
    }
    apply(next);
    // Keep `current()` in sync for the next repeat before React re-renders.
    live.current = { unit: u, current: () => next };
    return true;
  };

  const onStepPointerDown = (dir: 1 | -1) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopHold();
    if (!step(dir)) return;
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(() => step(dir), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };
  // Keyboard activation (Enter/Space) arrives as a click with detail 0.
  const onStepClick = (dir: 1 | -1) => (e: React.MouseEvent) => {
    if (e.detail === 0) step(dir);
  };

  const commit = (): number | null => {
    const parsed = parseQuantity(text, unit);
    if (!parsed.ok) {
      setError(parsed.error);
      return null;
    }
    setValue(parsed.value);
    setText(formatQuantityNumber(parsed.value, unit));
    setError(null);
    return parsed.value;
  };

  const changeUnit = (next: UnitType) => {
    if (next === unit) return;
    const parsed = parseQuantity(text, unit);
    const from = parsed.ok ? parsed.value : value;
    const converted = convertQuantity(parsed.ok ? from : quantityRules(unit).default, unit, next);
    setUnit(next);
    setValue(converted);
    setText(formatQuantityNumber(converted, next));
    setError(null);
    announce(
      `Unit changed to ${unitWord(next)}, quantity ${formatQuantityNumber(converted, next)}`,
    );
  };

  const confirm = () => {
    const parsed = parseQuantity(text, unit);
    if (!parsed.ok) {
      setError(parsed.error);
      fieldRef.current?.focus();
      return;
    }
    onConfirm({ product, quantity: parsed.value, unit, note: note.trim() });
  };

  const invalid = error !== null;
  const unitSuffix = counted ? null : unit;
  const fieldLabel = counted ? 'Quantity' : `Quantity in ${unit}`;
  const subline = [
    product.custom ? 'Custom item' : null,
    product.packSize,
    product.custom ? null : product.brand,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={headingRef}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      onClose={onClose}
      onCompactChange={setCompact}
      header={
        <div className="flex items-start gap-3 pb-3">
          <ProductImage
            src={product.imageUrl}
            name={product.name}
            padding="p-1"
            letterClassName={compact ? 'text-xl' : 'text-2xl'}
            className={`shrink-0 rounded-sm ${compact ? 'h-10 w-10' : 'h-14 w-14'}`}
          />
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className={`text-lg focus:outline-none ${compact ? 'truncate' : 'line-clamp-2'}`}
            >
              {product.name}
            </h2>
            {!compact && subline && <p className="truncate text-sm text-muted">{subline}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
          >
            <X aria-hidden className="h-6 w-6" />
          </button>
        </div>
      }
      footer={
        <>
          <Button aria-disabled={invalid} onClick={confirm}>
            Add to list
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-2">
        <div>
          <label htmlFor={`${headingId}-qty`} className="mb-1 block text-sm font-semibold">
            Quantity
          </label>
          <div className="flex items-stretch gap-2">
            <StepButton
              label="Decrease quantity"
              disabled={!canStep(-1)}
              onPointerDown={onStepPointerDown(-1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onClick={onStepClick(-1)}
            >
              <Minus aria-hidden className="h-6 w-6" />
            </StepButton>
            <div
              className={`relative flex min-h-primary min-w-0 flex-1 items-center justify-center rounded-md border-2 bg-surface ${
                invalid ? 'border-danger' : 'border-border'
              } focus-within:border-accent`}
            >
              <input
                ref={fieldRef}
                id={`${headingId}-qty`}
                type="text"
                inputMode={whole ? 'numeric' : 'decimal'}
                enterKeyHint="done"
                autoComplete="off"
                aria-label={fieldLabel}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                value={text}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setText(sanitiseQuantityInput(e.target.value));
                  setError(null);
                }}
                onBlur={() => {
                  commit();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (commit() !== null) e.currentTarget.blur();
                  }
                }}
                style={{ width: `${Math.max(2, text.length + 1)}ch` }}
                className="min-h-[52px] min-w-14 max-w-full bg-transparent text-center text-2xl font-bold text-text focus:outline-none"
              />
              {unitSuffix && (
                <span aria-hidden className="pr-1 text-lg font-semibold text-muted">
                  {unitSuffix}
                </span>
              )}
            </div>
            <StepButton
              label="Increase quantity"
              disabled={!canStep(1)}
              onPointerDown={onStepPointerDown(1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onClick={onStepClick(1)}
            >
              <Plus aria-hidden className="h-6 w-6" />
            </StepButton>
          </div>
          {invalid && (
            <p id={errorId} className="mt-2 flex items-start gap-1 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          {rules.presets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
              {rules.presets.map((p) => {
                const selected = !invalid && p === current();
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => apply(p)}
                    className={`flex min-h-tap items-center gap-1 rounded-full border-2 px-4 text-base font-semibold ${
                      selected
                        ? 'border-accent bg-accent text-accent-on'
                        : 'border-border bg-surface text-text'
                    }`}
                  >
                    {selected && <Check aria-hidden className="h-4 w-4" strokeWidth={3} />}
                    {presetLabel(p, unit)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p id={`${headingId}-unit`} className="mb-1 text-sm text-muted">
            Unit
          </p>
          <SegmentedControl
            label="Unit"
            variant="quiet"
            options={UNIT_TYPES}
            value={unit}
            onChange={changeUnit}
            describedBy={`${headingId}-unit`}
          />
          {/* TODO(B-004, docs/BACKLOG.md): "Remember {unit} for this product" checkbox once
              Stage 2 household settings can store the unit override. */}
        </div>

        <div>
          <label htmlFor={`${headingId}-note`} className="mb-1 block text-sm font-semibold">
            Note (optional)
          </label>
          <textarea
            id={`${headingId}-note`}
            rows={2}
            maxLength={NOTE_MAX_LENGTH}
            enterKeyHint="done"
            placeholder="e.g. get white if red is out of stock"
            value={note}
            onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onFocus={(e) => e.currentTarget.scrollIntoView?.({ block: 'nearest' })}
            className="block w-full resize-none rounded-md border-2 border-border bg-surface p-3 text-base text-text placeholder:text-muted focus:border-accent"
          />
          {note.length >= NOTE_MAX_LENGTH * 0.75 && (
            <p className="mt-1 text-right text-sm text-muted">
              {note.length}/{NOTE_MAX_LENGTH}
            </p>
          )}
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </BottomSheet>
  );
}

function StepButton({
  label,
  disabled,
  children,
  ...rest
}: {
  label: string;
  disabled: boolean;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      {...rest}
      className={`flex h-14 w-14 shrink-0 touch-manipulation select-none items-center justify-center rounded-md border-2 border-border bg-surface active:bg-accent-soft ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {children}
    </button>
  );
}
