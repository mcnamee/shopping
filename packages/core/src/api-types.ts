/** Response shapes shared between services/api and apps/web. */
import type { UnitType } from './product';

export interface HealthResponse {
  status: 'ok';
}

export interface MeResponse {
  userId: string;
  email: string;
  householdId: string;
}

export type ErrorCode =
  | 'UNAUTHORISED'
  | 'NO_HOUSEHOLD'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'INTERNAL';

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
}

/** 400 VALIDATION: which field failed. */
export interface ValidationErrorResponse extends ErrorResponse {
  code: 'VALIDATION';
  field?: string;
}

// ---------------------------------------------------------------------------------------
// Products (Stage 1)

/** One search result / product card. */
export interface ProductSummary {
  /** ALDI SKU (digits) or `custom-<uuid>` for a household custom product. */
  sku: string;
  name: string;
  brand: string | null;
  /** Hotlinked store image (any https host), or null (custom products, missing image). */
  imageUrl: string | null;
  /** AUD cents; per kg for loose produce. Null for custom products. */
  price: number | null;
  /** e.g. "$1.70 per 1 L"; null when unknown. */
  unitPrice: string | null;
  /** e.g. "2 L", "500 g", "5 each", "per kg", "approx. 0.96 kg". Null when unknown. */
  packSize: string | null;
  unitType: UnitType;
  /** Household group id (see DEFAULT_GROUPS). */
  groupId: string;
  /** True for household custom products. */
  custom: boolean;
}

/**
 * GET /api/products/search?q=&category=&cursor=&limit=
 * - q: free text (type-ahead; prefix matching). Optional when `category` is given.
 * - category: group id filter (e.g. "dairy-eggs").
 * - limit: 1-48, default 24.
 * - cursor: opaque `nextCursor` from the previous page.
 * Discontinued catalogue products are excluded.
 */
export interface ProductSearchResponse {
  items: ProductSummary[];
  /** Pass back as `cursor` for the next page; null when there are no more results. */
  nextCursor: string | null;
}

/** GET /api/products/{sku} */
export interface ProductDetailResponse extends ProductSummary {
  /** Catalogue product no longer seen in ALDI's range (kept for history). */
  discontinued: boolean;
}

/** POST /api/products/custom */
export interface CreateCustomProductRequest {
  /** 1-80 characters after trimming. */
  name: string;
  unitType: UnitType;
  /** One of DEFAULT_GROUPS ids. */
  groupId: string;
}

/** 201 Created: the new product. */
export type CreateCustomProductResponse = ProductSummary;

/** 409 CONFLICT: a custom product with the same name already exists (returned in `item`). */
export interface CustomProductConflictResponse extends ErrorResponse {
  code: 'CONFLICT';
  item: ProductSummary;
}
