/** Fake api.aldi.com.au for tests, built from the real fixtures. */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AldiCategoryNode, AldiProduct, AldiSearchResponse } from '../src/aldi-types';

const FIXTURES = path.join(__dirname, 'fixtures');

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

export function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

export const ALL_FIXTURE_PRODUCTS: AldiProduct[] = [
  'search-fruit-veg-casey.json',
  'search-meat-casey.json',
  'search-milk-category-casey.json',
  'search-q-banana-casey.json',
  'search-liquor-casey.json',
  'search-bakery-casey.json',
  'search-q-milk-default.json',
].flatMap((f) => fixture<AldiSearchResponse>(f).data);

/** Real Casey liquor incl. spirits (not in ALL_FIXTURE_PRODUCTS: those mirror the offline crawl). */
export const LIQUOR_FIXTURE_PRODUCTS: AldiProduct[] = fixture<AldiSearchResponse>(
  'liquor-spirits-casey.json',
).data;

/** Clone a real product with a new SKU (and optional category list). */
export function productLike(
  base: AldiProduct,
  sku: string,
  overrides: Partial<AldiProduct> = {},
): AldiProduct {
  return { ...structuredClone(base), sku, ...overrides };
}

export interface FakeAldiOptions {
  tree: AldiCategoryNode[];
  /** Products per top-level category key. */
  byCategory: Record<string, AldiProduct[]>;
  /** Body `data` for GET /v2/service-points/<id> (404 when omitted). */
  servicePoint?: { id: string; alcoholAvailability: string[] };
  /** Respond with this for request number N (1-based), instead of the normal response. */
  override?: (n: number, url: URL) => Response | undefined;
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function fakeAldi(options: FakeAldiOptions) {
  const calls: URL[] = [];
  const headers: Headers[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(url);
    headers.push(new Headers(init?.headers));
    const o = options.override?.(calls.length, url);
    if (o) return o;
    if (url.pathname === '/v2/product-category-tree') return json(200, { data: options.tree });
    if (url.pathname.startsWith('/v2/service-points/')) {
      return options.servicePoint
        ? json(200, { data: options.servicePoint })
        : json(404, { errors: [{ code: '3501', message: 'Merchant not found' }] });
    }
    if (url.pathname === '/v3/product-search') {
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const key = url.searchParams.get('categoryKey');
      const all = key ? (options.byCategory[key] ?? []) : Object.values(options.byCategory).flat();
      const body: AldiSearchResponse = {
        meta: { pagination: { offset, limit, totalCount: all.length } },
        data: all.slice(offset, offset + limit),
      };
      return json(200, body);
    }
    return json(404, { errors: [{ code: '404', message: 'not found' }] });
  };
  return { fetchImpl, calls, headers };
}

/** No-op clock for AldiClient: sleeps advance a virtual clock instantly. */
export function virtualClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

export function node(
  key: string,
  name: string,
  slug: string,
  children: AldiCategoryNode[] = [],
): AldiCategoryNode {
  return { key, name, urlSlugText: slug, order: null, children };
}
