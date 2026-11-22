/**
 * Stage 1 criteria C1/C2/C3/C9: ranking fixture, paging without gaps, and a warm
 * latency benchmark over a 3,000-product catalogue.
 */
import type { Context } from 'aws-lambda';
import { buildSearchIndex, type CatalogueProduct, type ProductSearchResponse } from '@trolley/core';
import { describe, expect, it } from 'vitest';
import { createHandler } from '../handler';
import { createRouter, type ApiEvent } from '../router';
import { createRoutes } from '../routes';
import type { SearchableCatalogueProduct } from './catalogue-cache';

const claims = { sub: 'u', token_use: 'id', 'custom:householdId': 'home-1' };

function searchEvent(query: Record<string, string>): ApiEvent {
  return {
    version: '2.0',
    routeKey: 'GET /api/products/search',
    rawPath: '/api/products/search',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    queryStringParameters: query,
    requestContext: {
      accountId: '1',
      apiId: 'a',
      domainName: 'x',
      domainPrefix: 'x',
      http: { method: 'GET', path: '/', protocol: 'HTTP/1.1', sourceIp: '1', userAgent: 't' },
      requestId: 'r',
      routeKey: 'GET /api/products/search',
      stage: '$default',
      time: '',
      timeEpoch: 0,
      authorizer: { jwt: { claims, scopes: null } },
    },
  } as ApiEvent;
}

const p = (sku: string, name: string, brand: string | null, groupId: string): CatalogueProduct => ({
  sku,
  name,
  brand,
  packSize: null,
  unitType: 'pack',
  price: 100,
  unitPrice: null,
  imageUrl: null,
  groupId,
  categories: [],
  storeId: 'G526',
  firstSeenAt: '',
  lastSeenAt: '',
  missedRuns: 0,
  discontinued: false,
});

function handlerFor(products: CatalogueProduct[]) {
  const index = buildSearchIndex(products as SearchableCatalogueProduct[]);
  const bySku = new Map(products.map((x) => [x.sku, x]));
  return createHandler(
    createRouter(
      createRoutes({
        catalogue: { get: async () => ({ index, bySku, loadedAt: 0 }) },
        custom: {
          list: async () => [],
          get: async () => null,
          create: async () => {
            throw new Error('unused');
          },
        },
      }),
    ),
  );
}

const ctx = { awsRequestId: 'r' } as Context;
const parse = (res: { body?: string }) => JSON.parse(String(res.body)) as ProductSearchResponse;

describe('C2 ranking', () => {
  it('q=milk: exact word > word prefix > brand-only, case- and diacritic-insensitive', async () => {
    const handler = handlerFor([
      p('1', 'Choc Chip Cookies', 'Milk Lane', 'snacks'), // brand-only match
      p('2', 'Milky Bar 50g', 'Nestle', 'snacks'), // prefix match in name
      p('3', 'Full Cream Milk 2L', 'Dairy Fine', 'dairy-eggs'), // exact word in name
      p('4', 'Café MILK Latte 250ml', null, 'drinks'), // exact, different case + accent
      p('5', 'Bread', null, 'bakery'),
    ]);
    const names = parse(await handler(searchEvent({ q: 'MILK' }), ctx)).items.map((i) => i.name);
    // Both exact; "Milk" is the head noun of Full Cream Milk but not of Milk Latte.
    expect(names).toEqual([
      'Full Cream Milk 2L',
      'Café MILK Latte 250ml',
      'Milky Bar 50g',
      'Choc Chip Cookies',
    ]);
    const accent = parse(await handler(searchEvent({ q: 'cafe' }), ctx)).items.map((i) => i.name);
    expect(accent).toEqual(['Café MILK Latte 250ml']);
  });

  it('breaks ties by name', async () => {
    const handler = handlerFor([
      p('1', 'Zesty Milk 1L', null, 'dairy-eggs'),
      p('2', 'Apple Milk 1L', null, 'dairy-eggs'),
    ]);
    const names = parse(await handler(searchEvent({ q: 'milk' }), ctx)).items.map((i) => i.name);
    expect(names).toEqual(['Apple Milk 1L', 'Zesty Milk 1L']);
  });
});

// ~3,000 synthetic products built from real ALDI words.
const ADJ = [
  'Light',
  'Full Cream',
  'Organic',
  'Smoked',
  'Sliced',
  'Free Range',
  'Greek',
  'Wholemeal',
  'Frozen',
  'Crunchy',
  'Spicy',
  'Lite',
  'Natural',
  'Classic',
  'Premium',
];
const NOUN = [
  'Milk',
  'Yoghurt',
  'Cheese',
  'Bread',
  'Bananas',
  'Chicken Breast',
  'Beef Mince',
  'Pasta',
  'Rice',
  'Coffee',
  'Tea Bags',
  'Tissues',
  'Dog Food',
  'Nappies',
  'Chips',
  'Chocolate',
  'Ice Cream',
  'Shampoo',
  'Sausages',
  'Salmon',
];
const SIZE = ['1L', '2L', '500g', '1kg', '200g', '6 Pack', '12 Pack', '750ml', '100g', '3L'];
const BRANDS = [
  'Farmdale',
  'Choceur',
  'Remano',
  'Belmont',
  'Just Organic',
  'Westacre',
  'Specially Selected',
  null,
];
const GROUPS = [
  'dairy-eggs',
  'bakery',
  'fruit-veg',
  'meat-seafood',
  'pantry',
  'frozen',
  'snacks',
  'household',
];
const BIG: CatalogueProduct[] = [];
for (let i = 0; BIG.length < 3000; i++) {
  const name = `${ADJ[i % ADJ.length]} ${NOUN[Math.floor(i / ADJ.length) % NOUN.length]} ${SIZE[i % SIZE.length]}`;
  BIG.push(
    p(String(100000 + i), name, BRANDS[i % BRANDS.length] ?? null, GROUPS[i % GROUPS.length]!),
  );
}

describe('C3 paging', () => {
  it('returns every result exactly once across pages (default page size 20)', async () => {
    const handler = handlerFor(BIG);
    const seen: string[] = [];
    let cursor: string | null = null;
    let total = 0;
    do {
      const res = parse(
        await handler(searchEvent({ q: 'milk', ...(cursor ? { cursor } : {}) }), ctx),
      );
      expect(res.items.length).toBeLessThanOrEqual(20);
      seen.push(...res.items.map((i) => i.sku));
      total = res.total;
      cursor = res.nextCursor;
    } while (cursor);
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    expect(total).toBeGreaterThan(20);
  });

  it('browses a category A to Z with no query', async () => {
    const handler = handlerFor(BIG);
    const res = parse(await handler(searchEvent({ category: 'bakery', limit: '48' }), ctx));
    const names = res.items.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-AU')));
    expect(res.total).toBe(BIG.filter((x) => x.groupId === 'bakery').length);
  });
});

describe('C9 latency', () => {
  it('p95 < 500 ms warm over 3,000 products and 100 queries (typically < 10 ms)', async () => {
    const handler = handlerFor(BIG);
    const queries = [
      'milk',
      'mi',
      'organic yog',
      'beef',
      'tis',
      'chocolate 200g',
      'free range',
      'zzz',
      'b',
      'coffee',
    ];
    await handler(searchEvent({ q: 'warm' }), ctx);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const res = await handler(searchEvent({ q: queries[i % queries.length]! }), ctx);
      times.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[94]!;
    expect(p95).toBeLessThan(500);
  });
});
