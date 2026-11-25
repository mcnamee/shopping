/**
 * Resolve a product id from a request into the household's view of it: a catalogue SKU
 * or one of the household's own custom products (A2). Returns null for anything else,
 * including another household's custom product and a catalogue product that has been
 * removed from the catalogue (soft delete, D-123: `discontinued`). Existing list, template
 * and history rows keep their snapshots; `GET /products/{sku}` still returns the product.
 */
import {
  catalogueSummary,
  customSummary,
  isCustomSku,
  isValidSku,
  type ProductSummary,
} from '@trolley/core';
import type { ProductDeps } from './routes';

export type ProductResolver = (
  householdId: string,
  productId: string,
) => Promise<ProductSummary | null>;

export function productResolver(deps: Pick<ProductDeps, 'catalogue' | 'custom'>): ProductResolver {
  return async (householdId, productId) => {
    if (!isValidSku(productId)) return null;
    if (isCustomSku(productId)) {
      const custom = await deps.custom.get(householdId, productId);
      return custom ? customSummary(custom) : null;
    }
    const product = (await deps.catalogue.get()).bySku.get(productId);
    return product && !product.discontinued ? catalogueSummary(product) : null;
  };
}
