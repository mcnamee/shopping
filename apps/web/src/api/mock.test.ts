import type { ProductSearchResponse, ProductSummary } from '@trolley/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_CATALOGUE } from './fixtures/products';
import { mockFetch, resetMockCustomProducts } from './mock';

const claims = { sub: 'user-1', email: 'a@example.com', 'custom:householdId': 'home-1' };
const token = (c: Record<string, string>) =>
  `Bearer mock.${btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

async function call(
  path: string,
  init: RequestInit = {},
  c: Record<string, string> | null = claims,
) {
  const headers = {
    ...(c ? { authorization: token(c) } : {}),
    ...(init.headers as Record<string, string>),
  };
  const promise = mockFetch(`/api${path}`, { ...init, headers });
  await vi.runAllTimersAsync();
  const res = await promise;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMockCustomProducts();
});

describe('mock product API', () => {
  it('has ~60 real products across all groups with https images', () => {
    expect(MOCK_CATALOGUE.length).toBeGreaterThanOrEqual(55);
    expect(new Set(MOCK_CATALOGUE.map((p) => p.groupId)).size).toBe(16);
    for (const p of MOCK_CATALOGUE) expect(p.imageUrl).toMatch(/^https:\/\//);
  });

  it('searches "milk" and returns ALDI milk first', async () => {
    const { status, body } = await call('/products/search?q=milk');
    expect(status).toBe(200);
    const res = body as unknown as ProductSearchResponse;
    expect(res.items[0]!.name).toMatch(/Milk/);
    expect(res.total).toBeGreaterThan(5);
    expect(res.items.every((i) => !i.custom)).toBe(true);
    const juice = (await call('/products/search?q=juice')).body as unknown as ProductSearchResponse;
    expect(juice.items.find((i) => i.custom)).toMatchObject({
      name: 'Fresh orange juice',
      unitType: 'L',
    });
  });

  it('browses a category and pages with a cursor', async () => {
    const first = (await call('/products/search?category=dairy-eggs&limit=5'))
      .body as unknown as ProductSearchResponse;
    expect(first.items).toHaveLength(5);
    const second = (
      await call(`/products/search?category=dairy-eggs&limit=5&cursor=${first.nextCursor}`)
    ).body as unknown as ProductSearchResponse;
    expect(second.items[0]!.sku).not.toBe(first.items[0]!.sku);
  });

  it('mirrors API validation, auth and the error magic query', async () => {
    expect((await call('/products/search')).status).toBe(400);
    expect((await call('/products/search?q=milk', {}, null)).status).toBe(401);
    expect((await call('/products/search?q=__error')).status).toBe(500);
  });

  it('gets a product by sku and 404s unknown ones', async () => {
    const sku = MOCK_CATALOGUE[0]!.sku;
    expect((await call(`/products/${sku}`)).body).toMatchObject({ sku, discontinued: false });
    expect((await call('/products/999')).status).toBe(404);
  });

  it('creates household custom products that then appear in search', async () => {
    const created = await call('/products/custom', {
      method: 'POST',
      body: JSON.stringify({ name: 'Wagyu sausages', unitType: 'kg', groupId: 'meat-seafood' }),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Wagyu sausages', custom: true });
    const found = (await call('/products/search?q=wagyu')).body as unknown as ProductSearchResponse;
    expect(found.items.some((i: ProductSummary) => i.sku === created.body.sku)).toBe(true);
    const other = (
      await call(
        '/products/search?q=wagyu sausages',
        {},
        { ...claims, 'custom:householdId': 'home-2' },
      )
    ).body as unknown as ProductSearchResponse;
    expect(other.items.some((i) => i.custom)).toBe(false);
    expect(
      (await call('/products/custom', { method: 'POST', body: JSON.stringify({ name: '' }) })).body,
    ).toMatchObject({ code: 'VALIDATION', field: 'name' });
  });

  it('lists groups', async () => {
    const { body } = await call('/groups');
    expect((body.groups as unknown[]).length).toBe(16);
  });
});
