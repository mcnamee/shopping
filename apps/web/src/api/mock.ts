/**
 * In-browser mock of the Trolley API, used when VITE_MOCK_AUTH=true so the app and
 * Playwright tests run against `vite dev` with no AWS. Add handlers here as new
 * endpoints are built, mirroring services/api behaviour (incl. 401/403 rules).
 */
import {
  applyUnitOverride,
  buildSearchIndex,
  customSummary,
  decodeCursor,
  groupsInOrder,
  isDefaultGroupId,
  isUnitType,
  MAX_QUERY_LENGTH,
  mergeRanked,
  paginate,
  searchProducts,
  tokenise,
  type CustomProduct,
  type ErrorResponse,
  type GroupsResponse,
  type HealthResponse,
  type MeResponse,
  type ProductDetailResponse,
  type ProductSearchResponse,
  type ProductSummary,
} from '@trolley/core';
import { MOCK_CATALOGUE } from './fixtures/products';
import {
  createStage2MockRoutes,
  mockAisleOrder,
  mockUnitOverrides,
  resetMockStage2,
} from './mock-stage2';

type Claims = Record<string, string>;
type MockHandler = (ctx: {
  claims: Claims | null;
  body: unknown;
  url: URL;
  params: Record<string, string>;
}) => Response;
interface MockRoute {
  auth: boolean;
  handler: MockHandler;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function decodeMockToken(header: string | null): Claims | null {
  const match = header?.match(/^Bearer mock\.([\w-]+)$/);
  if (!match?.[1]) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as Claims;
  } catch {
    return null;
  }
}

const validation = (message: string, field?: string) =>
  json(400, { code: 'VALIDATION', message, ...(field ? { field } : {}) });

// ------------------------------------------------------------------ Products (Stage 1)
// Mirrors services/api/src/products/routes.ts. Ranking uses the same @trolley/core code.

/**
 * Magic queries for QA/E2E in mock mode:
 *   "__error" -> 500 (error state), "__slow" -> 3 s delay (loading skeletons),
 *   "__expired" -> 401 (session expiry mid-use),
 *   "__many" -> 60 synthetic products (infinite scroll, last page has a short tail),
 *   "__manyfail" -> as "__many" but each page after the first fails twice (the UI retries once) (load-more error).
 */
export const MOCK_ERROR_QUERY = '__error';
export const MOCK_SLOW_QUERY = '__slow';
export const MOCK_EXPIRED_QUERY = '__expired';
export const MOCK_MANY_QUERY = '__many';
export const MOCK_MANY_FAIL_QUERY = '__manyfail';
const MANY_COUNT = 60;
const failedOffsets = new Map<number, number>();

const manyCatalogue: ProductSummary[] = Array.from({ length: MANY_COUNT }, (_, i) => ({
  sku: `9000000000${String(i).padStart(8, '0')}`,
  name: `Synthetic Item ${String(i + 1).padStart(2, '0')}`,
  brand: 'Test Brand',
  imageUrl: null,
  price: 100 + i,
  unitPrice: null,
  packSize: '1 each',
  unitType: 'each',
  groupId: 'pantry',
  custom: false,
}));

type MockSearchable = ProductSummary & { discontinued?: boolean };

const catalogueIndex = buildSearchIndex<MockSearchable>(MOCK_CATALOGUE);

/** Seeded custom products (also cover the g / L / mL unit types for the quantity modal). */
const SEED_CUSTOM: Array<
  Pick<CustomProduct, 'name' | 'unitType' | 'groupId' | 'brand' | 'packSize'>
> = [
  {
    name: 'Butcher lamb mince',
    unitType: 'kg',
    groupId: 'meat-seafood',
    brand: 'Local butcher',
    packSize: null,
  },
  { name: 'Shaved leg ham', unitType: 'g', groupId: 'deli', brand: null, packSize: null },
  {
    name: 'Fresh orange juice',
    unitType: 'L',
    groupId: 'drinks',
    brand: 'Farmers market',
    packSize: null,
  },
  {
    name: 'Cold brew coffee concentrate',
    unitType: 'mL',
    groupId: 'drinks',
    brand: null,
    packSize: null,
  },
];

const customByHousehold = new Map<string, CustomProduct[]>();
let customSeq = 0;

function newCustomSku(): string {
  customSeq += 1;
  return `custom-00000000-0000-4000-8000-${String(customSeq).padStart(12, '0')}`;
}

function customsFor(householdId: string): CustomProduct[] {
  let list = customByHousehold.get(householdId);
  if (!list) {
    list = SEED_CUSTOM.map((c) => ({
      ...c,
      sku: newCustomSku(),
      createdAt: '',
      createdBy: 'mock',
    }));
    customByHousehold.set(householdId, list);
  }
  return list;
}

/** Test helper: forget custom products created in this page session. */
export function resetMockCustomProducts(): void {
  customByHousehold.clear();
  customSeq = 0;
}

/** Test helper: forget everything (custom products and Stage 2 lists/templates/settings). */
export function resetMockApi(): void {
  resetMockCustomProducts();
  resetMockStage2();
}

/** Resolve a product id as the API does: catalogue SKU or this household's custom product. */
function findProduct(householdId: string, sku: string): ProductSummary | null {
  const custom = customsFor(householdId).find((c) => c.sku === sku);
  if (custom) return customSummary(custom);
  return MOCK_CATALOGUE.find((p) => p.sku === sku) ?? null;
}

function noHousehold() {
  return json(403, {
    code: 'NO_HOUSEHOLD',
    message: 'This account is not linked to a household',
  } satisfies ErrorResponse);
}

function cleanText(value: string): string {
  return value
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const productRoutes: Record<string, MockRoute> = {
  'GET /api/products/search': {
    auth: true,
    handler: ({ claims, url }) => {
      const householdId = claims?.['custom:householdId'];
      if (!householdId) return noHousehold();
      const q = (url.searchParams.get('q') ?? '').trim();
      const category = url.searchParams.get('category')?.trim() || undefined;
      if (q === MOCK_ERROR_QUERY) {
        return json(500, {
          code: 'INTERNAL',
          message: 'Internal server error',
        } satisfies ErrorResponse);
      }
      if (q === MOCK_EXPIRED_QUERY) {
        return json(401, { code: 'UNAUTHORISED', message: 'Unauthorised' } satisfies ErrorResponse);
      }
      if (q === MOCK_MANY_QUERY || q === MOCK_MANY_FAIL_QUERY) {
        const lim = Number(url.searchParams.get('limit') ?? 20);
        const cur = url.searchParams.get('cursor');
        const off = cur ? (decodeCursor(cur) ?? 0) : 0;
        if (q === MOCK_MANY_FAIL_QUERY && off > 0 && (failedOffsets.get(off) ?? 0) < 2) {
          // Twice, because the UI retries a 5xx once before surfacing the error.
          failedOffsets.set(off, (failedOffsets.get(off) ?? 0) + 1);
          return json(500, { code: 'INTERNAL', message: 'Internal server error' });
        }
        const pg = paginate(manyCatalogue, off, lim);
        return json(200, {
          items: pg.items,
          total: manyCatalogue.length,
          nextCursor: pg.nextCursor,
        } satisfies ProductSearchResponse);
      }
      if (q.length > MAX_QUERY_LENGTH) return validation('q too long', 'q');
      if (category !== undefined && !isDefaultGroupId(category))
        return validation('Unknown category', 'category');
      const searchText = q === MOCK_SLOW_QUERY ? '' : q;
      if (tokenise(searchText).length === 0 && !category && q !== MOCK_SLOW_QUERY) {
        return validation('Enter a search term or choose a category', 'q');
      }
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw === null ? 20 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 48)
        return validation('limit must be 1-48', 'limit');
      const cursor = url.searchParams.get('cursor');
      const offset = cursor ? decodeCursor(cursor) : 0;
      if (offset === null) return validation('Invalid cursor', 'cursor');

      const options = category ? { groupId: category } : {};
      const customs = customsFor(householdId).map((c) => customSummary(c));
      const ranked = mergeRanked<MockSearchable>(
        searchProducts(catalogueIndex, searchText, options),
        searchProducts(buildSearchIndex<MockSearchable>(customs), searchText, options),
      );
      const page = paginate(ranked, offset, limit);
      const overrides = mockUnitOverrides(householdId);
      return json(200, {
        items: page.items.map((r) => {
          const { discontinued: _d, ...item } = r.item;
          return applyUnitOverride(item, overrides);
        }),
        total: ranked.length,
        nextCursor: page.nextCursor,
      } satisfies ProductSearchResponse);
    },
  },
  'GET /api/products/{sku}': {
    auth: true,
    handler: ({ claims, params }) => {
      const householdId = claims?.['custom:householdId'];
      if (!householdId) return noHousehold();
      const sku = params.sku ?? '';
      const custom = customsFor(householdId).find((c) => c.sku === sku);
      const item = custom ? customSummary(custom) : MOCK_CATALOGUE.find((p) => p.sku === sku);
      if (!item)
        return json(404, { code: 'NOT_FOUND', message: 'Not found' } satisfies ErrorResponse);
      return json(200, {
        ...applyUnitOverride(item, mockUnitOverrides(householdId)),
        discontinued: false,
      } satisfies ProductDetailResponse);
    },
  },
  'POST /api/products/custom': {
    auth: true,
    handler: ({ claims, body }) => {
      const householdId = claims?.['custom:householdId'];
      if (!householdId || !claims?.sub) return noHousehold();
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return validation('Body must be a JSON object');
      }
      const b = body as Record<string, unknown>;
      const name = typeof b.name === 'string' ? cleanText(b.name) : '';
      if (name.length < 1 || name.length > 80)
        return validation('Name must be 1-80 characters', 'name');
      const brand =
        b.brand === undefined || b.brand === null
          ? null
          : typeof b.brand === 'string'
            ? cleanText(b.brand)
            : 1;
      if (brand === 1 || (typeof brand === 'string' && brand.length > 40)) {
        return validation('Brand must be at most 40 characters', 'brand');
      }
      const packSize =
        b.packSize === undefined || b.packSize === null
          ? null
          : typeof b.packSize === 'string'
            ? cleanText(b.packSize)
            : 1;
      if (packSize === 1 || (typeof packSize === 'string' && packSize.length > 30)) {
        return validation('Pack size must be at most 30 characters', 'packSize');
      }
      const unitType = b.unitType ?? 'each';
      if (!isUnitType(unitType)) return validation('Choose how you buy it', 'unitType');
      const groupId = b.groupId ?? 'other';
      if (!isDefaultGroupId(groupId)) return validation('Choose a group', 'groupId');
      const product: CustomProduct = {
        sku: newCustomSku(),
        name,
        brand: brand || null,
        packSize: packSize || null,
        unitType,
        groupId,
        createdAt: new Date().toISOString(),
        createdBy: claims.sub,
      };
      customsFor(householdId).push(product);
      return json(201, customSummary(product));
    },
  },
  'GET /api/groups': {
    auth: true,
    handler: ({ claims }) => {
      const householdId = claims?.['custom:householdId'];
      if (!householdId) return noHousehold();
      return json(200, {
        groups: groupsInOrder(mockAisleOrder(householdId)),
      } satisfies GroupsResponse);
    },
  },
};

/** Keyed like HTTP API route keys: "METHOD /api/path". */
export const mockRoutes: Record<string, MockRoute> = {
  'GET /api/health': {
    auth: false,
    handler: () => json(200, { status: 'ok' } satisfies HealthResponse),
  },
  'GET /api/me': {
    auth: true,
    handler: ({ claims }) => {
      const householdId = claims?.['custom:householdId'];
      if (!claims?.sub || !householdId) {
        return json(403, {
          code: 'NO_HOUSEHOLD',
          message: 'This account is not linked to a household',
        } satisfies ErrorResponse);
      }
      return json(200, {
        userId: claims.sub,
        email: claims.email ?? '',
        householdId,
      } satisfies MeResponse);
    },
  },
  ...productRoutes,
  ...createStage2MockRoutes({
    find: findProduct,
    customs: (hh) => customsFor(hh).map(customSummary),
  }),
};

const PATTERNS = Object.keys(mockRoutes)
  .filter((k) => k.includes('{'))
  .map((key) => {
    const [method, path = ''] = key.split(' ');
    const names: string[] = [];
    const re = new RegExp(
      `^${path.replace(/\{(\w+)\}/g, (_m, name: string) => {
        names.push(name);
        return '([^/]+)';
      })}$`,
    );
    return { key, method, re, names };
  });

/** Resolve "METHOD /path" to a route key, including path parameters like {sku}. */
function matchRoute(
  method: string,
  pathname: string,
): { key: string; params: Record<string, string> } | null {
  const exact = `${method} ${pathname}`;
  if (mockRoutes[exact]) return { key: exact, params: {} };
  for (const p of PATTERNS) {
    if (p.method !== method) continue;
    const m = p.re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    p.names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? '');
    });
    return { key: p.key, params };
  }
  return null;
}

/**
 * Test seam for error states (I1): set `window.__mockApiFail = { match: 'PATCH /api/lists/',
 * status: 500, times: 1 }` and the next matching request(s) (method + path prefix) fail.
 * `times` defaults to 1; -1 fails until the seam is cleared.
 */
interface MockFailSeam {
  match: string;
  status?: number;
  times?: number;
}

function takeFailure(method: string, pathname: string): Response | null {
  const g = globalThis as { __mockApiFail?: MockFailSeam | null };
  const seam = g.__mockApiFail;
  if (!seam || !`${method} ${pathname}`.startsWith(seam.match)) return null;
  const times = seam.times ?? 1;
  if (times !== -1) {
    if (times <= 1) g.__mockApiFail = null;
    else seam.times = times - 1;
  }
  const status = seam.status ?? 500;
  return json(status, {
    code: status === 409 ? 'CONFLICT' : 'INTERNAL',
    message: status === 409 ? 'Changed on another phone' : 'Internal server error',
    ...(status === 409 ? { reason: 'STALE' } : {}),
  });
}

export const mockFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://mock.local',
  );
  const method = (init?.method ?? 'GET').toUpperCase();
  // Test seam: Playwright sets `window.__mockApiLog = []` to count calls.
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog?.push(
    `${method} ${url.pathname}${url.search}`,
  );
  const match = matchRoute(method, url.pathname);
  const route = match ? mockRoutes[match.key] : undefined;
  const slow = url.searchParams.get('q')?.trim() === MOCK_SLOW_QUERY;
  // Test seam: `window.__mockApiDelay = { match: 'POST /api/lists/', ms: 3000 }` slows the
  // matching requests (method + path prefix), e.g. to see a loading state or cancel it.
  const delay = (globalThis as { __mockApiDelay?: { match: string; ms: number } | null })
    .__mockApiDelay;
  const delayed = delay && `${method} ${url.pathname}`.startsWith(delay.match) ? delay.ms : null;
  await new Promise((resolve) => setTimeout(resolve, delayed ?? (slow ? 3000 : 100)));
  // A cancelled request rejects like fetch does.
  if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  // Behave like the network when the browser is offline (Playwright context.setOffline).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new TypeError('Failed to fetch');
  }
  const failure = takeFailure(method, url.pathname);
  if (failure) return failure;
  if (!route || !match) {
    return json(404, { code: 'NOT_FOUND', message: 'Not found' } satisfies ErrorResponse);
  }

  const headers = new Headers(init?.headers);
  const claims = decodeMockToken(headers.get('authorization'));
  if (route.auth && !claims) {
    return json(401, { code: 'UNAUTHORISED', message: 'Unauthorised' } satisfies ErrorResponse);
  }

  let body: unknown = undefined;
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      return validation('Body must be a JSON object');
    }
  }
  return route.handler({ claims, body, url, params: match.params });
};
