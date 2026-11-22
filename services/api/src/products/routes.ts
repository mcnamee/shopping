/**
 * Product routes (Stage 1):
 *   GET  /api/products/search?q=&category=&cursor=&limit=
 *   GET  /api/products/{sku}
 *   POST /api/products/custom
 * All authed; household comes only from verified claims.
 */
import {
  catalogueSummary,
  customSummary,
  decodeCursor,
  isCustomSku,
  isDefaultGroupId,
  isUnitType,
  isValidSku,
  mergeRanked,
  MAX_QUERY_LENGTH,
  paginate,
  searchProducts,
  buildSearchIndex,
  tokenise,
  type CatalogueProduct,
  type CreateCustomProductRequest,
  type CustomProduct,
  type CustomProductConflictResponse,
  type ProductDetailResponse,
  type ProductSearchResponse,
  type ProductSummary,
} from '@trolley/core';
import { errors, json, type HttpResult } from '../http';
import type { AuthedRequest, RouteTable } from '../router';
import type { CatalogueSnapshot } from './catalogue-cache';
import { MAX_CUSTOM_PRODUCTS } from './custom-products';

export interface ProductDeps {
  catalogue: { get(): Promise<CatalogueSnapshot> };
  custom: {
    list(householdId: string): Promise<CustomProduct[]>;
    get(householdId: string, sku: string): Promise<CustomProduct | null>;
    create(
      householdId: string,
      input: {
        name: string;
        unitType: CreateCustomProductRequest['unitType'];
        groupId: string;
        createdBy: string;
      },
    ): Promise<CustomProduct>;
  };
  /**
   * Hook for Stage 3: extra ranking score per product from household purchase history
   * (e.g. "usual product"). Returns 0 for neutral.
   */
  historyBoost?: (householdId: string) => Promise<(sku: string) => number>;
}

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;
export const MAX_NAME_LENGTH = 80;
const MAX_BODY_BYTES = 2048;

type Searchable =
  (CatalogueProduct & { custom?: false }) | (CustomProduct & { brand: null; custom: true });

function toSummary(item: Searchable): ProductSummary {
  return item.custom ? customSummary(item) : catalogueSummary(item);
}

function parseBody(req: AuthedRequest): { ok: true; value: unknown } | { ok: false } {
  const raw = req.event.body;
  if (!raw) return { ok: false };
  const text = req.event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (text.length > MAX_BODY_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Collapse whitespace; strip control characters. */
function cleanName(value: string): string {
  return value
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createProductRoutes(deps: ProductDeps): RouteTable {
  async function search(req: AuthedRequest): Promise<HttpResult> {
    const params = req.event.queryStringParameters ?? {};
    const q = (params.q ?? '').trim();
    const category = params.category?.trim() || undefined;
    if (q.length > MAX_QUERY_LENGTH)
      return errors.validation(`q must be at most ${MAX_QUERY_LENGTH} characters`, 'q');
    if (category !== undefined && !isDefaultGroupId(category))
      return errors.validation('Unknown category', 'category');
    if (tokenise(q).length === 0 && !category)
      return errors.validation('Enter a search term or choose a category', 'q');

    let limit = DEFAULT_PAGE_SIZE;
    if (params.limit !== undefined) {
      limit = Number(params.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        return errors.validation(`limit must be 1-${MAX_PAGE_SIZE}`, 'limit');
      }
    }
    let offset = 0;
    if (params.cursor) {
      const decoded = decodeCursor(params.cursor);
      if (decoded === null) return errors.validation('Invalid cursor', 'cursor');
      offset = decoded;
    }

    const householdId = req.household.householdId;
    const [snapshot, customs, boostFn] = await Promise.all([
      deps.catalogue.get(),
      deps.custom.list(householdId),
      deps.historyBoost ? deps.historyBoost(householdId) : Promise.resolve(undefined),
    ]);
    const options = {
      ...(category ? { groupId: category } : {}),
      ...(boostFn ? { boost: (p: Searchable) => boostFn(p.sku) } : {}),
    };
    const customIndex = buildSearchIndex<Searchable>(
      customs.map((c) => ({ ...c, brand: null, custom: true as const })),
    );
    const ranked = mergeRanked<Searchable>(
      searchProducts<Searchable>(snapshot.index, q, options),
      searchProducts<Searchable>(customIndex, q, options),
    );
    const page = paginate(ranked, offset, limit);
    return json(200, {
      items: page.items.map((r) => toSummary(r.item)),
      nextCursor: page.nextCursor,
    } satisfies ProductSearchResponse);
  }

  async function detail(req: AuthedRequest): Promise<HttpResult> {
    const sku = req.event.pathParameters?.sku;
    if (!isValidSku(sku)) return errors.notFound();
    if (isCustomSku(sku)) {
      const custom = await deps.custom.get(req.household.householdId, sku);
      if (!custom) return errors.notFound();
      return json(200, {
        ...customSummary(custom),
        discontinued: false,
      } satisfies ProductDetailResponse);
    }
    const product = (await deps.catalogue.get()).bySku.get(sku);
    if (!product) return errors.notFound();
    return json(200, {
      ...catalogueSummary(product),
      discontinued: product.discontinued,
    } satisfies ProductDetailResponse);
  }

  async function createCustom(req: AuthedRequest): Promise<HttpResult> {
    const parsed = parseBody(req);
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      return errors.validation('Body must be a JSON object');
    }
    const body = parsed.value as Record<string, unknown>;
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      return errors.validation(`Name must be 1-${MAX_NAME_LENGTH} characters`, 'name');
    }
    if (!isUnitType(body.unitType)) return errors.validation('Unknown unit type', 'unitType');
    if (!isDefaultGroupId(body.groupId)) return errors.validation('Unknown category', 'groupId');

    const householdId = req.household.householdId;
    const existing = await deps.custom.list(householdId);
    const key = tokenise(name).join(' ');
    const duplicate = existing.find((p) => tokenise(p.name).join(' ') === key);
    if (duplicate) {
      return json(409, {
        code: 'CONFLICT',
        message: 'You already have a product with this name',
        item: customSummary(duplicate),
      } satisfies CustomProductConflictResponse);
    }
    if (existing.length >= MAX_CUSTOM_PRODUCTS) {
      return errors.validation(
        `A household can have at most ${MAX_CUSTOM_PRODUCTS} custom products`,
      );
    }
    const created = await deps.custom.create(householdId, {
      name,
      unitType: body.unitType,
      groupId: body.groupId,
      createdBy: req.household.userId,
    });
    return json(201, customSummary(created));
  }

  return {
    'GET /api/products/search': { auth: true, handler: search },
    'GET /api/products/{sku}': { auth: true, handler: detail },
    'POST /api/products/custom': { auth: true, handler: createCustom },
  };
}
