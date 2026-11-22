/**
 * Map an ALDI product to the store-agnostic catalogue shape (minus run bookkeeping,
 * which persistence adds). Pure; no I/O.
 */
import {
  alcoholKind,
  alcoholNotLicensed,
  displayPackSize,
  inferUnitType,
  resolveGroup,
  type AlcoholKind,
  type CatalogueProduct,
  type SourceCategory,
} from '@trolley/core';
import type { AldiAsset, AldiProduct } from './aldi-types';

/** Fields the scraper derives from ALDI; firstSeenAt/lastSeenAt/missedRuns are added later. */
export type MappedProduct = Omit<
  CatalogueProduct,
  'firstSeenAt' | 'lastSeenAt' | 'missedRuns' | 'discontinued' | 'discontinuedAt'
> & {
  /** How the group was decided ('unmapped' = fell through to Other). */
  groupVia: string;
};

/** Grid images are ~180 CSS px wide; 400 px covers 2x displays. */
export const IMAGE_WIDTH = 400;
const IMAGE_HOST = /^https:\/\/[a-z0-9.-]+\.aldi\.cx\//;

export function imageUrl(
  assets: AldiAsset[] | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (!assets?.length) return null;
  const asset = assets.find((a) => a.assetType === 'FR01') ?? assets[0];
  if (!asset) return null;
  if (typeof asset.url !== 'string' || !IMAGE_HOST.test(asset.url)) return null;
  const safeSlug = encodeURIComponent(slug && /^[a-z0-9-]+$/.test(slug) ? slug : 'product');
  return asset.url.replace('{width}', String(IMAGE_WIDTH)).replace('{slug}', safeSlug);
}

/** "FARMDALE" -> "Farmdale", "BELMONT BISCUIT CO." -> "Belmont Biscuit Co.", "A2 THE A2 MILK COMPANY" -> "A2 The A2 Milk Company". */
export function displayBrand(raw: string | null | undefined): string | null {
  const brand = raw?.trim();
  if (!brand) return null;
  if (brand !== brand.toUpperCase()) return brand; // already mixed case
  return brand
    .split(/(\s+)/)
    .map((word) => {
      if (/^\s+$/.test(word)) return word;
      if (/[\d&]/.test(word)) return word; // A2, M&M'S
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function clean(text: string | null | undefined, max: number): string | null {
  const t = text?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Special Buys carry `onSaleDate`; a date after `today` (YYYY-MM-DD, store time zone)
 * means the product is announced but not on the shelves yet (D-080).
 */
export function notAtStoreFrom(
  onSaleDate: string | null | undefined,
  today: string | null,
): boolean {
  return !!today && !!onSaleDate && ISO_DATE.test(onSaleDate) && onSaleDate > today;
}

/** Store context for deciding `notAtStore` (both optional; unknown means keep the product). */
export interface StoreContext {
  /** Today, YYYY-MM-DD, store time zone. */
  today?: string | null;
  /** Kinds of alcohol the store's licence covers; null/undefined = unknown. */
  alcohol?: ReadonlySet<AlcoholKind> | null;
}

export function mapProduct(
  raw: AldiProduct,
  storeId: string | null,
  ctx: StoreContext = {},
): MappedProduct | null {
  const sku = raw.sku?.trim();
  const name = clean(raw.name, 200);
  if (!sku || !/^\d{1,32}$/.test(sku) || !name) return null;

  const categories: SourceCategory[] = (raw.categories ?? [])
    .filter((c) => typeof c?.id === 'string' && typeof c?.name === 'string')
    .map((c) => ({ key: c.id, name: c.name, slug: c.urlSlugText }));

  const price = raw.price ?? null;
  const unitPrice =
    clean(price?.comparisonDisplay, 60) ??
    (price?.perUnitDisplay && price.amountRelevantDisplay
      ? `${price.amountRelevantDisplay} per ${price.perUnitDisplay}`
      : null);

  const hints = {
    name,
    packSize: clean(raw.sellingSize, 80),
    unitPrice,
    soldByWeight:
      raw.weightType === '3' ||
      (raw.quantityUnit === 'kg' && !raw.sellingSize && raw.weightType !== '1'),
  };
  const unitType = inferUnitType(hints);
  const group = resolveGroup(categories, undefined, name);
  const amount = price?.amountRelevant ?? price?.amount;
  const kind = alcoholKind(categories, name, !!raw.ageRestriction);
  const notAtStore =
    notAtStoreFrom(raw.onSaleDate, ctx.today ?? null) ||
    alcoholNotLicensed(kind, ctx.alcohol ?? null);

  return {
    sku,
    name,
    brand: displayBrand(raw.brandName),
    packSize: displayPackSize(hints, unitType),
    unitType,
    price: typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount) : null,
    unitPrice,
    imageUrl: imageUrl(raw.assets, raw.urlSlugText),
    groupId: group.groupId,
    groupVia: group.via,
    categories,
    storeId,
    notAtStore,
    ...(raw.onSaleDate && ISO_DATE.test(raw.onSaleDate) ? { onSaleDate: raw.onSaleDate } : {}),
  };
}
