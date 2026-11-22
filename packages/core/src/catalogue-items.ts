/**
 * DynamoDB item <-> domain conversions for catalogue and custom products. Pure (no AWS
 * SDK) so the scraper, API and tests share one definition of the stored shape.
 */
import { keys } from './keys';
import type { CatalogueProduct, CustomProduct, SourceCategory, UnitType } from './product';
import { isUnitType } from './product';
import type { ProductSummary } from './api-types';

export type DbItem = Record<string, unknown>;

export function catalogueProductToItem(p: CatalogueProduct, updatedAt: string): DbItem {
  return {
    pk: keys.productPk(p.sku),
    sk: keys.productSk,
    gsi1pk: keys.catalogueGsi1Pk,
    gsi1sk: keys.catalogueGsi1Sk(p.groupId, p.sku),
    entity: 'Product',
    ...p,
    updatedAt,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function categoriesOf(v: unknown): SourceCategory[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c: unknown) => {
    if (typeof c !== 'object' || c === null) return [];
    const r = c as Record<string, unknown>;
    const key = str(r.key);
    const name = str(r.name);
    if (!key || !name) return [];
    const slug = str(r.slug);
    return [slug ? { key, name, slug } : { key, name }];
  });
}

/** Tolerant read: returns null for items that are not valid products. */
export function itemToCatalogueProduct(item: DbItem): CatalogueProduct | null {
  const sku = str(item.sku);
  const name = str(item.name);
  if (!sku || !name || item.entity !== 'Product') return null;
  const unitType: UnitType = isUnitType(item.unitType) ? item.unitType : 'each';
  const product: CatalogueProduct = {
    sku,
    name,
    brand: str(item.brand),
    packSize: str(item.packSize),
    unitType,
    price: num(item.price),
    unitPrice: str(item.unitPrice),
    imageUrl: str(item.imageUrl),
    groupId: str(item.groupId) ?? 'other',
    categories: categoriesOf(item.categories),
    storeId: str(item.storeId),
    firstSeenAt: str(item.firstSeenAt) ?? '',
    lastSeenAt: str(item.lastSeenAt) ?? '',
    missedRuns: num(item.missedRuns) ?? 0,
    discontinued: item.discontinued === true,
  };
  const discontinuedAt = str(item.discontinuedAt);
  if (discontinuedAt) product.discontinuedAt = discontinuedAt;
  return product;
}

export function customProductToItem(householdId: string, p: CustomProduct): DbItem {
  return {
    pk: keys.householdPk(householdId),
    sk: keys.customProductSk(p.sku),
    entity: 'CustomProduct',
    ...p,
  };
}

export function itemToCustomProduct(item: DbItem): CustomProduct | null {
  const sku = str(item.sku);
  const name = str(item.name);
  if (!sku || !name || item.entity !== 'CustomProduct') return null;
  return {
    sku,
    name,
    unitType: isUnitType(item.unitType) ? item.unitType : 'each',
    groupId: str(item.groupId) ?? 'other',
    createdAt: str(item.createdAt) ?? '',
    createdBy: str(item.createdBy) ?? '',
  };
}

export function catalogueSummary(p: CatalogueProduct): ProductSummary {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    price: p.price,
    unitPrice: p.unitPrice,
    packSize: p.packSize,
    unitType: p.unitType,
    groupId: p.groupId,
    custom: false,
  };
}

export function customSummary(p: CustomProduct): ProductSummary {
  return {
    sku: p.sku,
    name: p.name,
    brand: null,
    imageUrl: null,
    price: null,
    unitPrice: null,
    packSize: null,
    unitType: p.unitType,
    groupId: p.groupId,
    custom: true,
  };
}
