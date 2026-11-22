import { PutCommand, QueryCommand, type GetCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import {
  buildSearchIndex,
  type CatalogueProduct,
  type CustomProduct,
  type ProductSearchResponse,
} from '@trolley/core';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../handler';
import { createRouter, type ApiEvent } from '../router';
import { createRoutes } from '../routes';
import {
  CatalogueCache,
  dynamoCatalogueLoader,
  type SearchableCatalogueProduct,
} from './catalogue-cache';
import { CustomProductRepo } from './custom-products';
import type { DocSender } from './doc';
import type { ProductDeps } from './routes';

const claims = {
  sub: 'user-1',
  email: 'a@example.com',
  token_use: 'id',
  'custom:householdId': 'home-1',
};
const context = { awsRequestId: 'r' } as Context;

function event(
  routeKey: string,
  opts: {
    query?: Record<string, string>;
    path?: Record<string, string>;
    body?: unknown;
    claims?: Record<string, unknown> | null;
  } = {},
): ApiEvent {
  const [method = 'GET', path = '/'] = routeKey.split(' ');
  const c = opts.claims === undefined ? claims : opts.claims;
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    ...(opts.query ? { queryStringParameters: opts.query } : {}),
    ...(opts.path ? { pathParameters: opts.path } : {}),
    ...(opts.body !== undefined
      ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }
      : {}),
    requestContext: {
      accountId: '1',
      apiId: 'api',
      domainName: 'x',
      domainPrefix: 'x',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 't' },
      requestId: 'r',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      ...(c ? { authorizer: { jwt: { claims: c, scopes: null } } } : {}),
    },
  } as ApiEvent;
}

const product = (
  sku: string,
  name: string,
  groupId: string,
  extra: Partial<CatalogueProduct> = {},
): CatalogueProduct => ({
  sku,
  name,
  brand: 'Farmdale',
  packSize: '2 L',
  unitType: 'pack',
  price: 339,
  unitPrice: '$1.70 per 1 L',
  imageUrl: `https://dm.apac.cms.aldi.cx/is/image/aldiprodapac/product/jpg/scaleWidth/400/x/${sku}`,
  groupId,
  categories: [],
  storeId: 'G526',
  firstSeenAt: '2026-11-01T00:00:00.000Z',
  lastSeenAt: '2026-11-01T00:00:00.000Z',
  missedRuns: 0,
  discontinued: false,
  ...extra,
});

const CATALOGUE = [
  product('398691', 'Light Milk 2L', 'dairy-eggs'),
  product('759535', 'Light Milk 1L', 'dairy-eggs'),
  product('285757', 'Milk Chocolate Block 200g', 'snacks', { brand: 'Choceur', packSize: '200 g' }),
  product('100001', 'Cavendish Bananas per kg', 'fruit-veg', {
    brand: null,
    unitType: 'kg',
    packSize: 'per kg',
  }),
  product('100006', 'Old Milk 1L', 'dairy-eggs', { discontinued: true }),
  ...Array.from({ length: 30 }, (_, i) =>
    product(String(200000 + i), `Yoghurt Flavour ${i} 1kg`, 'dairy-eggs'),
  ),
];

function deps(customs: CustomProduct[] = [], extra: Partial<ProductDeps> = {}) {
  const store = new Map<string, CustomProduct[]>([['home-1', [...customs]]]);
  const d: ProductDeps = {
    catalogue: {
      get: async () => ({
        index: buildSearchIndex(CATALOGUE as SearchableCatalogueProduct[]),
        bySku: new Map(CATALOGUE.map((p) => [p.sku, p])),
        loadedAt: 0,
      }),
    },
    custom: {
      list: async (hh) => store.get(hh) ?? [],
      get: async (hh, sku) => (store.get(hh) ?? []).find((p) => p.sku === sku) ?? null,
      create: async (hh, input) => {
        const p: CustomProduct = {
          sku: `custom-${'0'.repeat(8)}-0000-0000-0000-${String(store.get(hh)?.length ?? 0).padStart(12, '0')}`,
          createdAt: 'now',
          ...input,
        };
        store.set(hh, [...(store.get(hh) ?? []), p]);
        return p;
      },
    },
    ...extra,
  };
  return { d, store, handler: createHandler(createRouter(createRoutes(d))) };
}

const body = (res: { body?: string }) => JSON.parse(String(res.body)) as Record<string, unknown>;

const FARM_MILK: CustomProduct = {
  sku: 'custom-11111111-2222-3333-4444-555555555555',
  name: 'Farm gate milk',
  unitType: 'L',
  groupId: 'dairy-eggs',
  createdAt: 'x',
  createdBy: 'user-2',
};

describe('GET /api/products/search', () => {
  it('requires auth', async () => {
    const { handler } = deps();
    const res = await handler(
      event('GET /api/products/search', { query: { q: 'milk' }, claims: null }),
      context,
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns ranked summaries, excluding discontinued, including household custom products', async () => {
    const { handler } = deps([FARM_MILK]);
    const res = await handler(event('GET /api/products/search', { query: { q: 'milk' } }), context);
    expect(res.statusCode).toBe(200);
    const result = body(res) as unknown as ProductSearchResponse;
    const names = result.items.map((i) => i.name);
    expect(names.slice(0, 3)).toEqual(
      expect.arrayContaining(['Light Milk 2L', 'Light Milk 1L', 'Farm gate milk']),
    );
    expect(names).not.toContain('Old Milk 1L');
    expect(names.at(-1)).toBe('Milk Chocolate Block 200g');
    expect(result.nextCursor).toBeNull();
    expect(result.items.find((i) => i.sku === '398691')).toEqual({
      sku: '398691',
      name: 'Light Milk 2L',
      brand: 'Farmdale',
      imageUrl: expect.stringMatching(/^https:\/\//),
      price: 339,
      unitPrice: '$1.70 per 1 L',
      packSize: '2 L',
      unitType: 'pack',
      groupId: 'dairy-eggs',
      custom: false,
    });
    expect(result.items.find((i) => i.custom)).toMatchObject({
      sku: FARM_MILK.sku,
      imageUrl: null,
      price: null,
      unitType: 'L',
    });
  });

  it('does not show another household its custom products', async () => {
    const { handler } = deps([FARM_MILK]);
    const res = await handler(
      event('GET /api/products/search', {
        query: { q: 'gate' },
        claims: { ...claims, 'custom:householdId': 'home-2' },
      }),
      context,
    );
    expect((body(res) as unknown as ProductSearchResponse).items).toEqual([]);
  });

  it('paginates with an opaque cursor', async () => {
    const { handler } = deps();
    const first = body(
      await handler(
        event('GET /api/products/search', { query: { q: 'yoghurt', limit: '12' } }),
        context,
      ),
    ) as unknown as ProductSearchResponse;
    expect(first.items).toHaveLength(12);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = body(
      await handler(
        event('GET /api/products/search', {
          query: { q: 'yoghurt', limit: '12', cursor: first.nextCursor! },
        }),
        context,
      ),
    ) as unknown as ProductSearchResponse;
    const third = body(
      await handler(
        event('GET /api/products/search', {
          query: { q: 'yoghurt', limit: '12', cursor: second.nextCursor! },
        }),
        context,
      ),
    ) as unknown as ProductSearchResponse;
    expect(third.items).toHaveLength(6);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items].map((i) => i.sku);
    expect(new Set(all).size).toBe(30);
  });

  it('filters by category, with or without q', async () => {
    const { handler } = deps();
    const res = body(
      await handler(
        event('GET /api/products/search', { query: { category: 'fruit-veg' } }),
        context,
      ),
    ) as unknown as ProductSearchResponse;
    expect(res.items.map((i) => i.name)).toEqual(['Cavendish Bananas per kg']);
    const res2 = body(
      await handler(
        event('GET /api/products/search', { query: { q: 'milk', category: 'snacks' } }),
        context,
      ),
    ) as unknown as ProductSearchResponse;
    expect(res2.items.map((i) => i.name)).toEqual(['Milk Chocolate Block 200g']);
  });

  it.each([
    [{}, 'q'],
    [{ q: '  !! ' }, 'q'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ q: 'milk', category: 'nope' }, 'category'],
    [{ q: 'milk', limit: '0' }, 'limit'],
    [{ q: 'milk', limit: '49' }, 'limit'],
    [{ q: 'milk', limit: 'abc' }, 'limit'],
    [{ q: 'milk', cursor: 'garbage!' }, 'cursor'],
  ])('rejects %j (field %s)', async (query, field) => {
    const { handler } = deps();
    const res = await handler(
      event('GET /api/products/search', { query: query as Record<string, string> }),
      context,
    );
    expect(res.statusCode).toBe(400);
    expect(body(res)).toMatchObject({ code: 'VALIDATION', field });
  });

  it('applies the purchase-history boost hook', async () => {
    const historyBoost = vi.fn(async () => (sku: string) => (sku === '285757' ? 100 : 0));
    const { handler } = deps([], { historyBoost });
    const res = body(
      await handler(event('GET /api/products/search', { query: { q: 'milk' } }), context),
    ) as unknown as ProductSearchResponse;
    expect(res.items[0]!.name).toBe('Milk Chocolate Block 200g');
    expect(historyBoost).toHaveBeenCalledWith('home-1');
  });
});

describe('GET /api/products/{sku}', () => {
  it('returns a catalogue product, including discontinued ones', async () => {
    const { handler } = deps();
    const res = await handler(
      event('GET /api/products/{sku}', { path: { sku: '100006' } }),
      context,
    );
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({
      sku: '100006',
      name: 'Old Milk 1L',
      discontinued: true,
      custom: false,
    });
  });

  it('returns the household custom product', async () => {
    const { handler } = deps([FARM_MILK]);
    const res = await handler(
      event('GET /api/products/{sku}', { path: { sku: FARM_MILK.sku } }),
      context,
    );
    expect(body(res)).toMatchObject({ name: 'Farm gate milk', custom: true, discontinued: false });
  });

  it('404s for unknown, malformed, or other-household SKUs', async () => {
    const { handler } = deps([FARM_MILK]);
    for (const sku of ['999', 'PRODUCT#1', '../x', '']) {
      const res = await handler(event('GET /api/products/{sku}', { path: { sku } }), context);
      expect(res.statusCode).toBe(404);
    }
    const other = await handler(
      event('GET /api/products/{sku}', {
        path: { sku: FARM_MILK.sku },
        claims: { ...claims, 'custom:householdId': 'home-2' },
      }),
      context,
    );
    expect(other.statusCode).toBe(404);
  });
});

describe('POST /api/products/custom', () => {
  it('creates a household custom product from verified claims only', async () => {
    const { handler, store } = deps();
    const res = await handler(
      event('POST /api/products/custom', {
        body: {
          name: '  Butcher   sausages ',
          unitType: 'kg',
          groupId: 'meat-seafood',
          householdId: 'home-2',
        },
      }),
      context,
    );
    expect(res.statusCode).toBe(201);
    expect(body(res)).toMatchObject({
      name: 'Butcher sausages',
      unitType: 'kg',
      groupId: 'meat-seafood',
      custom: true,
      imageUrl: null,
    });
    expect(store.get('home-1')).toHaveLength(1);
    expect(store.get('home-1')![0]!.createdBy).toBe('user-1');
    expect(store.get('home-2')).toBeUndefined();
  });

  it('409s with the existing product for a duplicate name', async () => {
    const { handler } = deps([FARM_MILK]);
    const res = await handler(
      event('POST /api/products/custom', {
        body: { name: 'farm gate MILK', unitType: 'L', groupId: 'dairy-eggs' },
      }),
      context,
    );
    expect(res.statusCode).toBe(409);
    expect(body(res)).toMatchObject({ code: 'CONFLICT', item: { sku: FARM_MILK.sku } });
  });

  it.each([
    [undefined, undefined],
    ['not json', undefined],
    [{ name: '', unitType: 'each', groupId: 'pantry' }, 'name'],
    [{ name: 'x'.repeat(81), unitType: 'each', groupId: 'pantry' }, 'name'],
    [{ name: 'Thing', unitType: 'dozen', groupId: 'pantry' }, 'unitType'],
    [{ name: 'Thing', unitType: 'each', groupId: 'garden' }, 'groupId'],
    [{ name: 'Thing', unitType: 'each', groupId: 'pantry', pad: 'x'.repeat(3000) }, undefined],
  ])('rejects %j', async (b, field) => {
    const { handler } = deps();
    const res = await handler(
      event('POST /api/products/custom', b === undefined ? {} : { body: b }),
      context,
    );
    expect(res.statusCode).toBe(400);
    expect(body(res).code).toBe('VALIDATION');
    if (field) expect(body(res).field).toBe(field);
  });
});

describe('CatalogueCache', () => {
  it('caches for the TTL, shares concurrent loads, and serves stale on refresh failure', async () => {
    let t = 0;
    const load = vi.fn(async () => CATALOGUE);
    const cache = new CatalogueCache(load, 1000, () => t);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.bySku.get('398691')!.name).toBe('Light Milk 2L');
    t = 999;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    t = 1000;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    load.mockRejectedValueOnce(new Error('ddb down'));
    t = 5000;
    const stale = await cache.get();
    expect(stale.bySku.size).toBe(CATALOGUE.length);
    spy.mockRestore();
  });

  it('throws when the first load fails', async () => {
    const cache = new CatalogueCache(async () => {
      throw new Error('ddb down');
    });
    await expect(cache.get()).rejects.toThrow('ddb down');
  });
});

type Cmd = Parameters<DocSender['send']>[0];
function fakeDoc(responses: Array<Record<string, unknown>> = []) {
  const calls: Cmd[] = [];
  const doc: DocSender = {
    send: async (cmd) => {
      calls.push(cmd);
      return responses.length > 1 ? responses.shift()! : (responses[0] ?? {});
    },
  };
  return { doc, calls };
}

describe('dynamoCatalogueLoader', () => {
  it('queries GSI1 with a projection, across pages', async () => {
    const item = { entity: 'Product', ...CATALOGUE[0] };
    const { doc, calls } = fakeDoc([
      { Items: [item], LastEvaluatedKey: { k: 1 } },
      { Items: [item] },
    ]);
    const products = await dynamoCatalogueLoader(doc, 'T')();
    expect(products).toHaveLength(2);
    expect(calls[0]).toBeInstanceOf(QueryCommand);
    expect((calls[0] as QueryCommand).input).toMatchObject({
      TableName: 'T',
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': 'CATALOGUE#PRODUCT' },
      ProjectionExpression: expect.stringContaining('#name'),
    });
    expect((calls[1] as QueryCommand).input.ExclusiveStartKey).toEqual({ k: 1 });
  });
});

describe('CustomProductRepo', () => {
  it('lists from the household partition only, caching for the TTL', async () => {
    let t = 0;
    const item = {
      pk: 'HH#home-1',
      sk: `PRODUCT#${FARM_MILK.sku}`,
      entity: 'CustomProduct',
      ...FARM_MILK,
    };
    const { doc, calls } = fakeDoc([{ Items: [item] }]);
    const repo = new CustomProductRepo(doc, 'T', 1000, () => t);
    expect(await repo.list('home-1')).toEqual([FARM_MILK]);
    expect((calls[0] as QueryCommand).input.ExpressionAttributeValues).toEqual({
      ':pk': 'HH#home-1',
      ':sk': 'PRODUCT#custom-',
    });
    await repo.list('home-1');
    expect(calls).toHaveLength(1);
    t = 1000;
    await repo.list('home-1');
    expect(calls).toHaveLength(2);
  });

  it('creates with a custom- uuid SKU, conditional put, and updates the cache', async () => {
    const { doc, calls } = fakeDoc([{ Items: [] }]);
    const repo = new CustomProductRepo(doc, 'T');
    await repo.list('home-1');
    const created = await repo.create('home-1', {
      name: 'Sausages',
      unitType: 'kg',
      groupId: 'meat-seafood',
      createdBy: 'u',
    });
    expect(created.sku).toMatch(/^custom-[0-9a-f-]{36}$/);
    const put = calls[1] as PutCommand;
    expect(put).toBeInstanceOf(PutCommand);
    expect(put.input).toMatchObject({
      TableName: 'T',
      ConditionExpression: 'attribute_not_exists(pk)',
      Item: {
        pk: 'HH#home-1',
        sk: `PRODUCT#${created.sku}`,
        entity: 'CustomProduct',
        name: 'Sausages',
      },
    });
    expect(await repo.list('home-1')).toEqual([created]);
  });

  it('gets by household + sku', async () => {
    const { doc, calls } = fakeDoc([{}]);
    expect(await new CustomProductRepo(doc, 'T').get('home-1', FARM_MILK.sku)).toBeNull();
    expect((calls[0] as GetCommand).input.Key).toEqual({
      pk: 'HH#home-1',
      sk: `PRODUCT#${FARM_MILK.sku}`,
    });
  });
});
