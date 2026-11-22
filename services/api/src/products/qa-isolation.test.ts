/**
 * QA (Stage 1, C5/C7): two households against the REAL CustomProductRepo backed by an
 * in-memory DynamoDB fake (Put/Get/Query on pk+sk), including per-household cache bleed.
 */
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { buildSearchIndex, type CatalogueProduct } from '@trolley/core';
import { describe, expect, it } from 'vitest';
import { createHandler } from '../handler';
import { createRouter, type ApiEvent } from '../router';
import { createRoutes } from '../routes';
import type { SearchableCatalogueProduct } from './catalogue-cache';
import { CustomProductRepo } from './custom-products';
import type { DocSender } from './doc';

const context = { awsRequestId: 'r' } as Context;

function fakeTable() {
  const items = new Map<string, Record<string, unknown>>();
  const doc = {
    send: async (cmd: unknown) => {
      if (cmd instanceof PutCommand) {
        const it = cmd.input.Item as Record<string, unknown>;
        const k = `${String(it.pk)}|${String(it.sk)}`;
        if (items.has(k)) throw new Error('ConditionalCheckFailed');
        items.set(k, it);
        return {};
      }
      if (cmd instanceof GetCommand) {
        const key = cmd.input.Key as Record<string, string>;
        const found = items.get(`${key.pk}|${key.sk}`);
        return found ? { Item: found } : {};
      }
      if (cmd instanceof QueryCommand) {
        const v = cmd.input.ExpressionAttributeValues as Record<string, string>;
        return {
          Items: [...items.values()].filter(
            (i) => i.pk === v[':pk'] && String(i.sk).startsWith(v[':sk'] ?? ''),
          ),
        };
      }
      throw new Error('unexpected command');
    },
  } as unknown as DocSender;
  return { doc, items };
}

const cat = (sku: string, name: string): CatalogueProduct => ({
  sku,
  name,
  brand: null,
  packSize: null,
  unitType: 'pack',
  price: 100,
  unitPrice: null,
  imageUrl: null,
  groupId: 'dairy-eggs',
  categories: [],
  storeId: 'G526',
  firstSeenAt: '',
  lastSeenAt: '',
  missedRuns: 0,
  discontinued: false,
});

function setup() {
  const { doc, items } = fakeTable();
  const products = [cat('1', 'Light Milk 2L')];
  const repo = new CustomProductRepo(doc, 'T');
  const handler = createHandler(
    createRouter(
      createRoutes({
        catalogue: {
          get: async () => ({
            index: buildSearchIndex(products as SearchableCatalogueProduct[]),
            bySku: new Map(products.map((p) => [p.sku, p])),
            loadedAt: 0,
          }),
        },
        custom: repo,
      }),
    ),
  );
  return { handler, items };
}

function ev(
  routeKey: string,
  hh: string | null,
  opts: { query?: Record<string, string>; path?: Record<string, string>; body?: unknown } = {},
): ApiEvent {
  const [method = 'GET', path = '/'] = routeKey.split(' ');
  const claims = {
    sub: `user-${hh ?? 'none'}`,
    token_use: 'id',
    ...(hh ? { 'custom:householdId': hh } : {}),
  };
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    ...(opts.query ? { queryStringParameters: opts.query } : {}),
    ...(opts.path ? { pathParameters: opts.path } : {}),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    requestContext: {
      accountId: '1',
      apiId: 'a',
      domainName: 'x',
      domainPrefix: 'x',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '1', userAgent: 't' },
      requestId: 'r',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      authorizer: { jwt: { claims, scopes: null } },
    },
  } as ApiEvent;
}

const json = (r: { body?: string }) =>
  JSON.parse(String(r.body)) as { items: Array<{ name: string; custom: boolean }> } & Record<
    string,
    unknown
  >;

describe('household isolation (real repo, in-memory table)', () => {
  it('household B never sees household A custom products in search or by SKU, even with warm caches', async () => {
    const { handler, items } = setup();
    // Warm both households' caches first, so a bleed would show.
    expect(
      json(
        await handler(ev('GET /api/products/search', 'home-a', { query: { q: 'milk' } }), context),
      ).items,
    ).toHaveLength(1);
    expect(
      json(
        await handler(ev('GET /api/products/search', 'home-b', { query: { q: 'milk' } }), context),
      ).items,
    ).toHaveLength(1);

    const created = await handler(
      ev('POST /api/products/custom', 'home-a', {
        body: { name: 'Secret goat milk', unitType: 'L', householdId: 'home-b', pk: 'HH#home-b' },
      }),
      context,
    );
    expect(created.statusCode).toBe(201);
    const sku = json(created).sku as string;
    // Stored only under household A.
    expect([...items.values()].map((i) => i.pk)).toEqual(['HH#home-a']);

    const a = json(
      await handler(ev('GET /api/products/search', 'home-a', { query: { q: 'goat' } }), context),
    );
    expect(a.items.map((i: { name: string }) => i.name)).toEqual(['Secret goat milk']);
    expect(a.items[0]?.custom).toBe(true);

    for (const q of ['goat', 'milk', 'secret']) {
      const b = json(
        await handler(ev('GET /api/products/search', 'home-b', { query: { q } }), context),
      );
      expect(JSON.stringify(b)).not.toContain('Secret goat milk');
    }
    // householdId in the query string is ignored.
    const spoof = json(
      await handler(
        ev('GET /api/products/search', 'home-b', { query: { q: 'goat', householdId: 'home-a' } }),
        context,
      ),
    );
    expect(spoof.items).toHaveLength(0);

    const own = await handler(ev('GET /api/products/{sku}', 'home-a', { path: { sku } }), context);
    expect(own.statusCode).toBe(200);
    const other = await handler(
      ev('GET /api/products/{sku}', 'home-b', { path: { sku } }),
      context,
    );
    expect(other.statusCode).toBe(404);
    expect(json(other).code).toBe('NOT_FOUND');
  });

  it('a token without a household gets 403 on every product route', async () => {
    const { handler } = setup();
    for (const [rk, o] of [
      ['GET /api/products/search', { query: { q: 'milk' } }],
      ['POST /api/products/custom', { body: { name: 'x' } }],
      ['GET /api/products/{sku}', { path: { sku: '1' } }],
    ] as const) {
      const r = await handler(ev(rk, null, o), context);
      expect(r.statusCode).toBe(403);
    }
  });
});
