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
 * - q: free text (type-ahead; word-prefix matching, case/accent-insensitive).
 *   Optional when `category` is given (then: browse the group A to Z).
 * - category: group id filter (see GET /api/groups), e.g. "dairy-eggs".
 * - limit: 1-48, default 20.
 * - cursor: opaque `nextCursor` from the previous page.
 * Discontinued catalogue products are excluded. Household custom products are included.
 */
export interface ProductSearchResponse {
  items: ProductSummary[];
  /** Total matches across all pages (for "24 results" / "Dairy & Eggs, 86 products"). */
  total: number;
  /** Pass back as `cursor` for the next page; null when there are no more results. */
  nextCursor: string | null;
}

/** GET /api/products/{sku} */
export interface ProductDetailResponse extends ProductSummary {
  /** Catalogue product no longer seen in ALDI's range (kept for history). */
  discontinued: boolean;
}

/**
 * POST /api/products/custom. Duplicate names are allowed (the UI offers "Use existing").
 * 400 VALIDATION with `field` for: name (required, 1-80 chars), brand (<= 40), packSize
 * (<= 30), unitType (one of UNIT_TYPES), groupId (a group id).
 */
export interface CreateCustomProductRequest {
  name: string;
  /** Default "each". */
  unitType?: UnitType;
  /** Default "other". */
  groupId?: string;
  brand?: string;
  packSize?: string;
}

/** 201 Created: the new product (custom: true). */
export type CreateCustomProductResponse = ProductSummary;

export interface GroupSummary {
  id: string;
  name: string;
  /** Chip label. */
  shortName: string;
}

/** GET /api/groups: the household's groups in aisle order (defaults until Stage 2). */
export interface GroupsResponse {
  groups: GroupSummary[];
}
