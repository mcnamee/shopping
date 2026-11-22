/**
 * Liquor licence helpers (D-080). ALDI publishes, per store, which kinds of alcohol it may
 * sell (`alcoholAvailability`, e.g. ALDI Casey = Beer + Wine, no spirits), but its product
 * search returns the same liquor range regardless, so the catalogue has to apply the licence.
 * Pure; the scraper supplies the store's availability and the product's age restriction.
 */
import type { SourceCategory } from './product';

export type AlcoholKind = 'beer' | 'wine' | 'spirits';

/** Store availability words (ALDI): "Beer", "Wine", and (never seen live) "Spirits". */
export function allowedAlcohol(
  availability: readonly string[] | null | undefined,
): Set<AlcoholKind> {
  const allowed = new Set<AlcoholKind>();
  for (const a of availability ?? []) {
    const k = a.trim().toLowerCase();
    if (k === 'beer' || k === 'wine' || k === 'spirits') allowed.add(k);
  }
  return allowed;
}

const LEAF_KIND: Record<string, AlcoholKind | 'premixed'> = {
  beer: 'beer',
  cider: 'beer',
  'white wine': 'wine',
  'red wine': 'wine',
  rose: 'wine',
  'sparkling & champagne': 'wine',
  spirits: 'spirits',
  premixed: 'premixed',
};

const SPIRIT_WORDS =
  /\b(gin|vodka|whisk(?:e)?y|bourbon|scotch|rum|tequila|brandy|cognac|liqueur|schnapps|mojito|margarita|cocktails?|jim beam|mixed minis)\b/i;
/** Premixed drinks that are malt/cider based, not spirit based. */
const NOT_SPIRIT_PREMIX = /\b(ginger beer|alcoholic|cider|beer|lager|ale)\b/i;

/**
 * What kind of alcohol a product is, or null when it is not alcohol or cannot be told
 * (callers must treat null as "keep": never hide what we are unsure about).
 */
export function alcoholKind(
  categories: readonly SourceCategory[],
  name: string,
  ageRestricted: boolean,
): AlcoholKind | null {
  let premixed = false;
  for (const c of categories) {
    const kind = LEAF_KIND[c.name.trim().toLowerCase()];
    if (kind === 'premixed') premixed = true;
    else if (kind) return kind;
  }
  if (premixed) return NOT_SPIRIT_PREMIX.test(name) ? null : 'spirits';
  if (ageRestricted && SPIRIT_WORDS.test(name) && !NOT_SPIRIT_PREMIX.test(name)) return 'spirits';
  return null;
}

/** True when the store's licence does not cover this product's kind of alcohol. */
export function alcoholNotLicensed(
  kind: AlcoholKind | null,
  allowed: ReadonlySet<AlcoholKind> | null,
): boolean {
  return kind !== null && allowed !== null && !allowed.has(kind);
}
