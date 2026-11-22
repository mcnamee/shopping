/**
 * Shapes of the (unofficial) ALDI AU web API, as observed Nov 2026 on api.aldi.com.au.
 * Only the fields we use are typed; everything is treated as untrusted and validated
 * in aldi-client.ts / map-product.ts.
 *
 * Endpoints:
 *   GET /v2/product-category-tree?currency=AUD
 *       -> { data: AldiCategoryNode[] }   (note: adding serviceType here returns 400 3801)
 *   GET /v3/product-search?currency=AUD&serviceType=walk-in&servicePoint=G526
 *         &categoryKey=<key>&q=<text>&limit=<12|16|24|30|32|48|60>&offset=<n>
 *       -> { meta: { pagination: { offset, limit, totalCount } }, data: AldiProduct[] }
 *   GET /v2/service-points?limit=100&offset=<n>
 *       -> { data: AldiServicePoint[] }  (all stores; ACT/Casey = "G526")
 *   GET /v2/service-points/<id>
 *       -> { data: AldiServicePoint }    (one store, incl. alcoholAvailability)
 */

export interface AldiCategoryNode {
  key: string;
  name: string;
  urlSlugText: string;
  order: number | null;
  children: AldiCategoryNode[];
}

export interface AldiPrice {
  /** Cents. */
  amount: number;
  amountRelevant?: number;
  amountRelevantDisplay?: string | null;
  comparison?: number | null;
  /** e.g. "$1.70 per 1 L" */
  comparisonDisplay?: string | null;
  perUnit?: number | null;
  /** e.g. "1 kg" for loose produce */
  perUnitDisplay?: string | null;
  wasPriceDisplay?: string | null;
}

export interface AldiAsset {
  /** Template with {width} and {slug} placeholders. */
  url: string;
  maxWidth?: number;
  /** FR01 = front-of-pack. */
  assetType?: string | null;
}

export interface AldiProductCategory {
  id: string;
  name: string;
  urlSlugText: string;
}

export interface AldiProduct {
  sku: string;
  name: string;
  brandName?: string | null;
  urlSlugText?: string | null;
  discontinued?: boolean;
  /** 18 for alcohol (D-080); null otherwise. */
  ageRestriction?: number | string | null;
  /** Special Buy go-on-sale date "YYYY-MM-DD"; null for the everyday range (D-080). */
  onSaleDate?: string | null;
  /** e.g. "While Stocks Last", "On Sale Sat 05 Dec"; null for the everyday range. */
  onSaleDateDisplay?: string | null;
  notForSale?: boolean;
  /** "ea" | "kg" | "bt" | "pac" */
  quantityUnit?: string | null;
  /** "0" fixed size, "1" random-weight pre-pack, "3" loose by weight. */
  weightType?: string | null;
  /** e.g. "2 l", "1 each", "approx. 0.96 kg per package"; null for loose/some liquor. */
  sellingSize?: string | null;
  price?: AldiPrice | null;
  categories?: AldiProductCategory[] | null;
  assets?: AldiAsset[] | null;
}

export interface AldiSearchResponse {
  meta: { pagination: { offset: number; limit: number; totalCount: number } };
  data: AldiProduct[];
}

export interface AldiServicePoint {
  id: string;
  name?: string;
  /** Kinds of alcohol the store may sell: "Beer", "Wine" (Casey: both; some stores: none). */
  alcoholAvailability?: string[] | null;
  availableCustomerServiceTypes?: string[] | null;
}
