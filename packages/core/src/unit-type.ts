/**
 * Default unitType inference from store pack-size / unit-price text (spec 3.2).
 *
 *   "per kg" (loose, weighed at the till)          -> kg
 *   "per 100 g" (loose, priced per 100 g)          -> g
 *   "approx. 0.96 kg per package" (random-weight)  -> pack  (you pick up packs, not kilos)
 *   "1 each" / "Lime Each"                         -> each
 *   "5 each" / "Lemons 5 Pack"                     -> pack
 *   "2 l" / "Light Milk 2L" / "500 g"              -> pack  (a pack of 2 L, spec example)
 *   nothing recognisable                           -> each
 *
 * Users can override per product (household preference, Stage 2+); this only picks the
 * starting point, so it errs towards the simplest stepper (each/pack).
 */
import type { UnitType } from './product';

export type MeasureUnit = 'each' | 'kg' | 'g' | 'L' | 'mL';

export interface PackSize {
  quantity: number;
  unit: MeasureUnit;
  /** Number of items in a multipack ("6 x 100g" -> 6), when stated. */
  count?: number;
}

const UNIT_ALIASES: Record<string, MeasureUnit> = {
  each: 'each',
  ea: 'each',
  pk: 'each',
  pack: 'each',
  packs: 'each',
  pc: 'each',
  pcs: 'each',
  piece: 'each',
  pieces: 'each',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  g: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  l: 'L',
  lt: 'L',
  ltr: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  liters: 'L',
  ml: 'mL',
  millilitre: 'mL',
  millilitres: 'mL',
};

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(each|ea|pk|packs?|pcs?|pieces?|kgs?|kilos?|gms?|grams?|g|litres?|liters?|ltr|lt|l|millilitres?|ml)`;

/** "6 x 100g", "24x600ml" */
const MULTIPACK_RE = new RegExp(String.raw`(\d+)\s*[x×]\s*${NUM}\s*${UNIT}\b`, 'i');
/** "2 l", "500g", "1.5 kg", "5 each" */
const SIZE_RE = new RegExp(String.raw`(?:^|[^\w.])${NUM}\s*${UNIT}(?![a-z])`, 'gi');
/** "Lemons 5 Pack", "Croissants 3 Pack", "Pack of 6" */
const N_PACK_RE = /\b(\d+)\s*(?:pack|pk)\b|\bpack of (\d+)\b/i;
const PER_KG_RE = /(?:\bper\s*(?:1\s*)?kg\b|\/\s*kg\b)/i;
const PER_100G_RE = /\bper\s*100\s*g\b/i;
const PER_LITRE_RE = /\bper\s*(?:1\s*)?(?:l|litre|liter)\b/i;
const APPROX_PACK_RE = /\bapprox\.?\b|\bper\s+(?:package|pack|pk)\b/i;
const EACH_WORD_RE = /\beach\b|\bea\b/i;
/** "x 12", "12 x", "6 pack", "6pk": a count of items. */
const COUNT_RE = /(?:^|\s)x\s*(\d+)\b|\b(\d+)\s*x(?:\s|$)|\b(\d+)\s*(?:packs?|pk)\b/i;
/** Pack text that is only a pricing unit, i.e. sold loose: "kg", "/kg", "litre". */
const BARE_UNIT: Record<string, UnitType> = {
  kg: 'kg',
  '/kg': 'kg',
  loose: 'kg',
  g: 'g',
  '100g': 'g',
  l: 'L',
  litre: 'L',
  liter: 'L',
  '/l': 'L',
  ml: 'mL',
};

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function unitOf(raw: string | undefined): MeasureUnit | undefined {
  return raw ? UNIT_ALIASES[raw.toLowerCase()] : undefined;
}

/** Parse the first recognisable size from text. Returns null if none. */
export function parsePackSize(text: string | null | undefined): PackSize | null {
  if (!text) return null;
  const multi = MULTIPACK_RE.exec(text);
  if (multi) {
    const unit = unitOf(multi[3]);
    const count = Number(multi[1]);
    const quantity = toNumber(multi[2] ?? '');
    if (unit && count > 0 && quantity > 0) return { quantity, unit, count };
  }
  SIZE_RE.lastIndex = 0;
  for (const match of text.matchAll(SIZE_RE)) {
    const unit = unitOf(match[2]);
    const quantity = toNumber(match[1] ?? '');
    if (unit && quantity > 0) return { quantity, unit };
  }
  return null;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Display form: "2 L", "384 mL", "500 g", "1.5 kg", "5 each", "6 x 100 g". */
export function formatPackSize(size: PackSize): string {
  const base = `${trimNumber(size.quantity)} ${size.unit}`;
  return size.count && size.count > 1 ? `${size.count} x ${base}` : base;
}

export interface UnitHints {
  /** Product name, e.g. "Light Milk 2L", "Cavendish Bananas per kg". */
  name: string;
  /** Pack-size text from the store, e.g. "2 l", "1 each", "approx. 0.4 kg per package". */
  packSize?: string | null;
  /** Unit-price text, e.g. "$1.70 per 1 L", "per kg", "1 kg". */
  unitPrice?: string | null;
  /**
   * Store says the item is loose and weighed at the till (ALDI weightType "3").
   * Random-weight pre-packs (ALDI weightType "1") are NOT soldByWeight: they are picked
   * up as packs.
   */
  soldByWeight?: boolean;
}

export function inferUnitType(hints: UnitHints): UnitType {
  const name = hints.name ?? '';
  const pack = hints.packSize ?? '';

  // Random-weight pre-packs ("approx. 0.96 kg per package"): you grab N packs.
  if (APPROX_PACK_RE.test(pack)) return 'pack';

  // Loose, weighed at the till.
  if (hints.soldByWeight) {
    if (PER_100G_RE.test(`${pack} ${hints.unitPrice ?? ''}`)) return 'g';
    return 'kg';
  }

  // Pack text that is a pricing basis ("per kg", "per 100g", "kg"), not a size.
  const bare = BARE_UNIT[pack.trim().toLowerCase()];
  if (bare) return bare;
  if (PER_KG_RE.test(pack)) return 'kg';
  if (PER_100G_RE.test(pack)) return 'g';
  if (PER_LITRE_RE.test(pack)) return 'L';

  const size = parsePackSize(pack);

  // No fixed size but priced by weight/volume in the name or pack text.
  if (!size) {
    const text = `${name} ${pack}`;
    if (PER_KG_RE.test(text)) return 'kg';
    if (PER_100G_RE.test(text)) return 'g';
    if (PER_LITRE_RE.test(text)) return 'L';
  }

  if (size) {
    if (size.unit === 'each') return size.quantity > 1 || (size.count ?? 1) > 1 ? 'pack' : 'each';
    return 'pack';
  }

  const count = COUNT_RE.exec(pack);
  if (count) return Number(count[1] ?? count[2] ?? count[3]) > 1 ? 'pack' : 'each';

  // Fall back to the name.
  const nPack = N_PACK_RE.exec(name);
  if (nPack) return Number(nPack[1] ?? nPack[2]) > 1 ? 'pack' : 'each';
  const nameSize = parsePackSize(name);
  if (nameSize) {
    if (nameSize.unit === 'each') return nameSize.quantity > 1 ? 'pack' : 'each';
    return 'pack';
  }
  if (EACH_WORD_RE.test(name)) return 'each';
  return 'each';
}

/**
 * Display pack size: normalised store text, else a size parsed from the name, else
 * "per kg"/"per 100 g" for loose items, else null.
 */
export function displayPackSize(hints: UnitHints, unitType: UnitType): string | null {
  const pack = hints.packSize?.trim();
  if (pack) {
    if (APPROX_PACK_RE.test(pack)) {
      const size = parsePackSize(pack);
      return size ? `approx. ${formatPackSize(size)}` : pack;
    }
    const size = parsePackSize(pack);
    return size ? formatPackSize(size) : pack;
  }
  if (unitType === 'kg') return 'per kg';
  if (unitType === 'g') return 'per 100 g';
  if (unitType === 'L') return 'per L';
  const fromName = parsePackSize(hints.name);
  return fromName ? formatPackSize(fromName) : null;
}
