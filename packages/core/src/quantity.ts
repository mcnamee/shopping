/**
 * Quantity rules for the quantity modal and (Stage 2) list items (docs/ux/quantity-modal.md
 * section 3, spec 3.2). Pure functions, no UI: step/min/max/presets per unit type,
 * kg<->g and L<->mL conversion, typed-entry validation and display formatting.
 *
 * Float safety: every result is rounded to the unit's precision (kg/L 2 dp, others whole),
 * so 0.5 + 0.25 is 0.75 and never 0.7500000000000001.
 */
import type { UnitType } from './product';

export interface QuantityRules {
  default: number;
  step: number;
  min: number;
  max: number;
  /** Decimal places kept (typed values are rounded to this silently). */
  decimals: number;
  presets: readonly number[];
}

export const QUANTITY_RULES: Record<UnitType, QuantityRules> = {
  each: { default: 1, step: 1, min: 1, max: 99, decimals: 0, presets: [] },
  pack: { default: 1, step: 1, min: 1, max: 99, decimals: 0, presets: [] },
  kg: { default: 1, step: 0.25, min: 0.05, max: 20, decimals: 2, presets: [0.5, 1, 1.5, 2] },
  g: { default: 500, step: 100, min: 10, max: 20000, decimals: 0, presets: [250, 500, 1000] },
  L: { default: 1, step: 0.5, min: 0.1, max: 20, decimals: 2, presets: [0.5, 1, 1.5, 2] },
  mL: { default: 500, step: 250, min: 50, max: 20000, decimals: 0, presets: [250, 500, 750, 1000] },
};

export const NOTE_MAX_LENGTH = 200;

export function quantityRules(unit: UnitType): QuantityRules {
  return QUANTITY_RULES[unit];
}

/** Whole-number units (each, pack, g, mL). */
export function isWholeUnit(unit: UnitType): boolean {
  return QUANTITY_RULES[unit].decimals === 0;
}

/** each / pack are counted; the rest are measured. */
export function isCountUnit(unit: UnitType): boolean {
  return unit === 'each' || unit === 'pack';
}

export function roundQuantity(value: number, unit: UnitType): number {
  const f = 10 ** QUANTITY_RULES[unit].decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function clampQuantity(value: number, unit: UnitType): number {
  const { min, max } = QUANTITY_RULES[unit];
  return Math.min(max, Math.max(min, roundQuantity(value, unit)));
}

const EPS = 1e-9;

/**
 * The value one step up or down. Off-grid values (1.3 kg) move to the next multiple of the
 * step in the pressed direction (1.5 / 1.25). Returns null when that would leave the
 * allowed range (the button is disabled).
 */
export function stepQuantity(value: number, unit: UnitType, direction: 1 | -1): number | null {
  const { step, min, max } = QUANTITY_RULES[unit];
  const ratio = value / step;
  const target =
    direction === 1 ? (Math.floor(ratio + EPS) + 1) * step : (Math.ceil(ratio - EPS) - 1) * step;
  const rounded = roundQuantity(target, unit);
  if (rounded < min - EPS || rounded > max + EPS) return null;
  return rounded;
}

const FAMILY: Partial<Record<UnitType, { family: 'mass' | 'volume'; perBase: number }>> = {
  kg: { family: 'mass', perBase: 1000 },
  g: { family: 'mass', perBase: 1 },
  L: { family: 'volume', perBase: 1000 },
  mL: { family: 'volume', perBase: 1 },
};

/**
 * Change unit. Within a family (kg<->g, L<->mL) the amount converts and is clamped to the
 * new range (1.5 kg -> 1500 g, 500 mL -> 0.5 L). Across families it resets to the new
 * unit's default.
 */
export function convertQuantity(value: number, from: UnitType, to: UnitType): number {
  if (from === to) return value;
  const a = FAMILY[from];
  const b = FAMILY[to];
  if (!a || !b || a.family !== b.family) return QUANTITY_RULES[to].default;
  return clampQuantity((value * a.perBase) / b.perBase, to);
}

/** Strip everything but digits and one decimal separator; `,` becomes `.`. */
export function sanitiseQuantityInput(text: string): string {
  let out = '';
  let seenDot = false;
  for (const ch of text.replace(',', '.')) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ch === '.' && !seenDot) {
      out += ch;
      seenDot = true;
    }
  }
  return out;
}

export function quantityRangeMessage(unit: UnitType): string {
  const { min, max } = QUANTITY_RULES[unit];
  if (isCountUnit(unit)) return `Enter an amount from ${min} to ${max}.`;
  return `Enter an amount from ${min} to ${max} ${unit}.`;
}

export type QuantityParse = { ok: true; value: number } | { ok: false; error: string };

/** Validate typed entry. Too many decimals (kg/L) round silently. */
export function parseQuantity(text: string, unit: UnitType): QuantityParse {
  const raw = text.trim().replace(',', '.');
  if (raw === '') return { ok: false, error: 'Enter a quantity.' };
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    return { ok: false, error: 'Use numbers only, like 1.5.' };
  }
  const n = Number(raw);
  if (isWholeUnit(unit) && !Number.isInteger(n)) {
    return { ok: false, error: 'Use a whole number, like 2.' };
  }
  const value = roundQuantity(n, unit);
  const { min, max } = QUANTITY_RULES[unit];
  if (value < min - EPS || value > max + EPS) {
    return { ok: false, error: quantityRangeMessage(unit) };
  }
  return { ok: true, value };
}

/** Plain number text for the input field: "1.5", "500", "0.75" (no trailing zeros). */
export function formatQuantityNumber(value: number, unit: UnitType): string {
  return String(roundQuantity(value, unit));
}

/**
 * Display with unit: "1.5 kg", "500 g", "2 L". Counted units show the bare number
 * ("2"); use {@link describeQuantity} for a sentence fragment.
 */
export function formatQuantity(value: number, unit: UnitType): string {
  const n = formatQuantityNumber(value, unit);
  return isCountUnit(unit) ? n : `${n} ${unit}`;
}

/** Preset chip label. 1000 g reads "1 kg" and 1000 mL reads "1 L" but keep their own unit. */
export function presetLabel(value: number, unit: UnitType): string {
  if (unit === 'g' && value >= 1000 && value % 1000 === 0) return `${value / 1000} kg`;
  if (unit === 'mL' && value >= 1000 && value % 1000 === 0) return `${value / 1000} L`;
  return formatQuantity(value, unit);
}

/** "1.5 kg Potatoes" / "2 x Milk" (for toasts and list rows). */
export function describeQuantity(value: number, unit: UnitType, name: string): string {
  return isCountUnit(unit)
    ? `${formatQuantityNumber(value, unit)} x ${name}`
    : `${formatQuantity(value, unit)} ${name}`;
}

const UNIT_WORDS: Record<UnitType, { one: string; many: string }> = {
  each: { one: 'item', many: 'items' },
  pack: { one: 'pack', many: 'packs' },
  kg: { one: 'kilogram', many: 'kilograms' },
  g: { one: 'gram', many: 'grams' },
  L: { one: 'litre', many: 'litres' },
  mL: { one: 'millilitre', many: 'millilitres' },
};

/** Spoken unit for screen readers: "litres", "1 kilogram". */
export function unitWord(unit: UnitType, value = 2): string {
  return value === 1 ? UNIT_WORDS[unit].one : UNIT_WORDS[unit].many;
}

/** Live-region text: "Quantity 1.5 litres". */
export function announceQuantity(value: number, unit: UnitType): string {
  return `Quantity ${formatQuantityNumber(value, unit)} ${unitWord(unit, value)}`;
}
