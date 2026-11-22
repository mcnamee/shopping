/**
 * Product domain types (spec 3.1, 3.2, 5.1). Store-agnostic: ALDI specifics live in
 * services/scraper (aldi-client.ts / map-product.ts).
 */

/** Drives the quantity modal (spec 3.2). */
export const UNIT_TYPES = ['each', 'pack', 'kg', 'g', 'L', 'mL'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && (UNIT_TYPES as readonly string[]).includes(value);
}

/** A category as the source store names it, e.g. ALDI "Dairy, Eggs & Fridge > Milk". */
export interface SourceCategory {
  /** Store's stable category key, e.g. "1111111160". */
  key: string;
  name: string;
  /** Store's slug path, e.g. "dairy-eggs-fridge/milk". */
  slug?: string;
}

/**
 * Catalogue product as persisted (PRODUCT#<sku> / META) and cached by the API.
 * Prices are informational only (price tracking is a non-goal).
 */
export interface CatalogueProduct {
  sku: string;
  name: string;
  /** Display-cased brand, or null when the store gives none. */
  brand: string | null;
  /** Human pack-size text, e.g. "2 L", "500 g", "5 each", "per kg", "approx. 0.96 kg per pack". */
  packSize: string | null;
  /** Default unit type inferred at scrape time; households may override (Stage 2+). */
  unitType: UnitType;
  /** Shelf price in AUD cents (per kg for loose produce), or null if unknown. */
  price: number | null;
  /** Unit price text from the store, e.g. "$1.70 per 1 L". */
  unitPrice: string | null;
  /** Hotlinked image URL from the store's CDN (D-033), or null. */
  imageUrl: string | null;
  /** Default household group from the seeded category map. */
  groupId: string;
  /** Store categories (top level and leaf), used for household category mapping. */
  categories: SourceCategory[];
  /** Store service point the data came from, e.g. "G526" (ALDI Casey ACT). */
  storeId: string | null;
  /** ISO timestamps. */
  firstSeenAt: string;
  lastSeenAt: string;
  /** Consecutive successful full runs that did not include this product. */
  missedRuns: number;
  discontinued: boolean;
  discontinuedAt?: string;
}

/** Household-scoped product a user added (HH#<hh> / PRODUCT#<id>). */
export interface CustomProduct {
  /** Always starts with CUSTOM_SKU_PREFIX so it can never collide with a store SKU. */
  sku: string;
  name: string;
  unitType: UnitType;
  groupId: string;
  createdAt: string;
  createdBy: string;
}

export const CUSTOM_SKU_PREFIX = 'custom-';

export function isCustomSku(sku: string): boolean {
  return sku.startsWith(CUSTOM_SKU_PREFIX);
}

/** Store SKUs are digits; custom SKUs are `custom-<uuid>`. Anything else is rejected. */
export const SKU_PATTERN = /^(?:\d{1,32}|custom-[0-9a-f-]{36})$/;

export function isValidSku(value: unknown): value is string {
  return typeof value === 'string' && SKU_PATTERN.test(value);
}
