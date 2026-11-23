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
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { TypeBadge } from '../components/TypeBadge';
import { useListsQuery, useTemplatesQuery } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { truncate } from './format';
import { ProductImage } from './ProductImage';
import { SegmentedControl } from './SegmentedControl';
import { describeTarget, type AddTarget } from './target';
import { TargetPicker } from './TargetPicker';

export interface QuantitySelection {
  product: ProductSummary;
  quantity: number;
  unit: UnitType;
  note: string;
  /** "Remember {unit}" was shown and ticked: save the household unit override (C5). */
  remember: boolean;
}

/** Throw from `onConfirm` to show this text in the sheet's error banner. */
export class ModalError extends Error {}

interface QuantityModalProps {
  /** `unitType` is the unit the sheet opens in (household override applied). */
  product: ProductSummary;
  /** `add` (default) shows the target row; `edit` is a saved row (quantity-modal.md 9). */
  mode?: 'add' | 'edit';
  /** Edit mode: the row's saved quantity, unit and note. */
  initial?: { quantity: number; unit: UnitType; note: string };
  /** Add mode: where the item goes. */
  target?: AddTarget;
  onTargetChange?: (target: AddTarget) => void;
  /** Add mode: open on the picker (ListPlus with no remembered template). */
  startOnPicker?: boolean;
  /** Add mode: the ListPlus icon started this (New template defaults to Meal). */
  fromTemplateIcon?: boolean;
  /** Resolve to close; reject (optionally with a ModalError) to show the banner. */
  onConfirm: (selection: QuantitySelection) => void | Promise<void>;
  /** Edit mode, list rows only: "Remove from list". */
  onRemove?: () => void;
  /** When set, the product header is a button that closes the sheet and finds it in Search. */
  onFindInSearch?: (product: ProductSummary) => void;
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
export function QuantityModal({
  product,
  mode = 'add',
  initial,
  target = { kind: 'thisWeek' },
  onTargetChange,
  startOnPicker = false,
  fromTemplateIcon = false,
  onConfirm,
  onRemove,
  onFindInSearch,
  onClose,
  returnFocusRef,
}: QuantityModalProps) {
  const editing = mode === 'edit';
  const headingId = useId();
  const pickerHeadingId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLElement>(null);

  const startUnit = initial?.unit ?? product.unitType;
  const startValue = initial?.quantity ?? quantityRules(startUnit).default;
  const [unit, setUnit] = useState<UnitType>(startUnit);
  const [value, setValue] = useState(startValue);
  const [text, setText] = useState(() => formatQuantityNumber(startValue, startUnit));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [remember, setRemember] = useState(true);
  const [view, setView] = useState<'form' | 'picker'>(
    !editing && startOnPicker ? 'picker' : 'form',
  );
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const targetRow = useRef<HTMLButtonElement>(null);
  const pickerHeading = useRef<HTMLHeadingElement>(null);
  const { online } = useOnlineStatus();
  const listsQuery = useListsQuery(!editing);
  const templatesQuery = useTemplatesQuery(!editing);
  const targetView = describeTarget(target, listsQuery.data?.lists, templatesQuery.data?.templates);
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

  const parsedNow = parseQuantity(text, unit);
  const dirty =
    !initial ||
    !parsedNow.ok ||
    parsedNow.value !== initial.quantity ||
    unit !== initial.unit ||
    note.trim() !== initial.note;
  const showRemember = unit !== product.unitType;
  const goingBack =
    product.defaultUnitType !== undefined &&
    product.unitType !== product.defaultUnitType &&
    unit === product.defaultUnitType;

  const confirm = async () => {
    if (submitting) return;
    const parsed = parseQuantity(text, unit);
    if (!parsed.ok) {
      setError(parsed.error);
      fieldRef.current?.focus();
      return;
    }
    if (editing && !dirty) return;
    if (!online) {
      setFailure(
        editing
          ? "You're offline. Reconnect to save this change."
          : "You're offline. Reconnect to add this item.",
      );
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      await onConfirm({
        product,
        quantity: parsed.value,
        unit,
        note: note.trim(),
        remember: showRemember && remember,
      });
    } catch (err) {
      setSubmitting(false);
      setFailure(
        err instanceof ModalError
          ? err.message
          : editing
            ? "Couldn't save that change. Please try again."
            : "Couldn't add that item. Please try again.",
      );
    }
  };

  // Focus follows the view: picker heading on open, the target row when coming back.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (view === 'picker') pickerHeading.current?.focus();
    else targetRow.current?.focus();
  }, [view]);

  const pickTarget = (next: AddTarget) => {
    onTargetChange?.(next);
    setView('form');
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

  const image = (
    <ProductImage
      letterAsContent={onFindInSearch !== undefined}
      src={product.imageUrl}
      name={product.name}
      padding="p-1"
      letterClassName={compact ? 'text-xl' : 'text-2xl'}
      className={`shrink-0 rounded-sm ${compact ? 'h-10 w-10' : 'h-14 w-14'}`}
    />
  );

  const inPicker = view === 'picker' && !editing;
  const addLabel = `Add to ${targetView.name}`;

  return (
    <BottomSheet
      labelledBy={inPicker ? pickerHeadingId : headingId}
      initialFocusRef={inPicker ? pickerHeading : headingRef}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      busy={submitting}
      onClose={onClose}
      onCompactChange={setCompact}
      header={
        inPicker ? (
          <div className="flex items-center gap-1 pb-3">
            <button
              type="button"
              aria-label="Back"
              onClick={() => setView('form')}
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
            >
              <ChevronLeft aria-hidden className="h-6 w-6" />
            </button>
            <h2
              id={pickerHeadingId}
              ref={pickerHeading}
              tabIndex={-1}
              className="min-w-0 flex-1 truncate text-lg focus:outline-none"
            >
              Choose where to add
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
            >
              <X aria-hidden className="h-6 w-6" />
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-3 pb-3">
            {onFindInSearch ? (
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-label={`Find ${product.name} in Search`}
                  onClick={() => onFindInSearch(product)}
                  className="-my-1 flex min-h-11 w-full min-w-0 items-start gap-3 rounded-sm py-1 text-left"
                >
                  <span aria-hidden className="shrink-0">
                    {image}
                  </span>
                  <span
                    id={headingId}
                    ref={headingRef as RefObject<HTMLSpanElement>}
                    role="heading"
                    aria-level={2}
                    tabIndex={-1}
                    className={`block min-w-0 flex-1 self-center text-lg focus:outline-none ${compact ? 'truncate' : 'line-clamp-2'}`}
                  >
                    {product.name}
                  </span>
                  <ChevronRight aria-hidden className="h-5 w-5 shrink-0 self-center text-muted" />
                </button>
                {!compact && subline && (
                  <p className={`truncate pt-1 text-sm text-muted ${compact ? '' : 'pl-[68px]'}`}>
                    {subline}
                  </p>
                )}
              </div>
            ) : (
              <>
                {image}
                <div className="min-w-0 flex-1">
                  <h2
                    id={headingId}
                    ref={headingRef as RefObject<HTMLHeadingElement>}
                    tabIndex={-1}
                    className={`text-lg focus:outline-none ${compact ? 'truncate' : 'line-clamp-2'}`}
                  >
                    {product.name}
                  </h2>
                  {!compact && subline && <p className="truncate text-sm text-muted">{subline}</p>}
                </div>
              </>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
            >
              <X aria-hidden className="h-6 w-6" />
            </button>
          </div>
        )
      }
      footer={
        inPicker ? null : (
          <>
            {failure && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
              >
                <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                {failure}
              </p>
            )}
            <Button
              aria-disabled={invalid || (editing && !dirty)}
              aria-label={editing ? undefined : addLabel}
              busy={submitting}
              busyLabel={editing ? 'Saving...' : 'Adding...'}
              onClick={() => void confirm()}
            >
              {editing ? 'Save' : `Add to ${truncate(targetView.name, 22)}`}
            </Button>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              Cancel
            </Button>
            {editing && onRemove && (
              <Button
                variant="secondary"
                className="border-transparent text-danger"
                onClick={onRemove}
              >
                <Trash2 aria-hidden className="h-5 w-5" />
                Remove from list
              </Button>
            )}
          </>
        )
      }
    >
      {inPicker ? (
        <TargetPicker
          value={target}
          lists={listsQuery.data?.lists}
          templates={templatesQuery.data?.templates}
          listsError={listsQuery.isError}
          online={online}
          newTemplateType={fromTemplateIcon ? 'meal' : 'weekly'}
          templatesFirst={fromTemplateIcon}
          expandNewTemplate={fromTemplateIcon && templatesQuery.data?.templates.length === 0}
          onSelect={pickTarget}
          onRetry={() => {
            void listsQuery.refetch();
            void templatesQuery.refetch();
          }}
        />
      ) : (
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
            {showRemember && (
              <label className="mt-2 flex min-h-tap cursor-pointer items-start gap-3 rounded-sm py-1">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="mt-1 h-6 w-6 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-base font-semibold">
                    {goingBack
                      ? `Go back to ${unit} for this product`
                      : `Remember ${unit} for this product`}
                  </span>
                  <span className="block text-sm text-muted">
                    {goingBack
                      ? `Next time it opens in ${unit}.`
                      : `Next time it opens in ${unit}. You can undo this in Settings.`}
                  </span>
                </span>
              </label>
            )}
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

          {!editing && (
            <div>
              <button
                ref={targetRow}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setView('picker')}
                className="flex min-h-primary w-full items-center gap-2 rounded-md border-2 border-border bg-surface px-4 text-left active:bg-accent-soft"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-muted">
                    {targetView.kind === 'template' ? 'Adding to template' : 'Adding to'}
                  </span>{' '}
                  <span className="flex items-center gap-2 text-lg font-semibold">
                    <span className="truncate">
                      {targetView.isNew ? `New list: ${targetView.name}` : targetView.name}
                    </span>{' '}
                    {targetView.thisWeek && !targetView.isNew && (
                      <span className="shrink-0 text-base font-normal text-muted">(This week)</span>
                    )}{' '}
                    {targetView.type && <TypeBadge type={targetView.type} />}
                  </span>
                </span>
                <span className="sr-only">. Change</span>
                <ChevronDown aria-hidden className="h-5 w-5 shrink-0" />
              </button>
            </div>
          )}
        </div>
      )}
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
