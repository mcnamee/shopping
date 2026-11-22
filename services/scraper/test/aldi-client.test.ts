import { describe, expect, it } from 'vitest';
import {
  AldiBlockedError,
  AldiClient,
  AldiHttpError,
  AldiShapeError,
  DEFAULT_USER_AGENT,
  RequestBudgetExceededError,
  pageSizeFor,
  type PageSize,
} from '../src/aldi-client';
import type { AldiCategoryNode } from '../src/aldi-types';
import { fakeAldi, fixture, fixtureText, json, virtualClock } from './fake-aldi';

const tree = fixture<{ data: AldiCategoryNode[] }>('category-tree.json').data;

function client(fetchImpl: typeof fetch, extra: ConstructorParameters<typeof AldiClient>[0] = {}) {
  const clock = virtualClock();
  const c = new AldiClient({
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0,
    ...extra,
  });
  return { c, clock };
}

describe('AldiClient', () => {
  it('parses the real category tree', async () => {
    const { fetchImpl, calls } = fakeAldi({ tree, byCategory: {} });
    const { c } = client(fetchImpl);
    const result = await c.getCategoryTree();
    expect(result.map((n) => n.name)).toContain('Dairy, Eggs & Fridge');
    // serviceType on the tree endpoint returns 400 3801, so it must not be sent.
    expect(calls[0]!.search).toBe('?currency=AUD');
  });

  it('sends walk-in, the Casey service point, paging params and an honest User-Agent', async () => {
    const { fetchImpl, calls, headers } = fakeAldi({ tree, byCategory: {} });
    const { c } = client(fetchImpl);
    await c.searchPage({ categoryKey: '960000000', offset: 60, limit: 60 });
    const params = Object.fromEntries(calls[0]!.searchParams);
    expect(params).toEqual({
      currency: 'AUD',
      serviceType: 'walk-in',
      servicePoint: 'G526',
      categoryKey: '960000000',
      limit: '60',
      offset: '60',
    });
    expect(headers[0]!.get('user-agent')).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).not.toMatch(/Chrome|Safari|Firefox|@/);
  });

  it('omits servicePoint when configured as null', async () => {
    const { fetchImpl, calls } = fakeAldi({ tree, byCategory: {} });
    await client(fetchImpl, { servicePoint: null }).c.searchPage({ offset: 0, limit: 12 });
    expect(calls[0]!.searchParams.has('servicePoint')).toBe(false);
  });

  it('rejects invalid service points and page sizes', async () => {
    expect(() => new AldiClient({ servicePoint: 'G526&x=1' })).toThrow();
    const { fetchImpl } = fakeAldi({ tree, byCategory: {} });
    await expect(
      client(fetchImpl).c.searchPage({ offset: 0, limit: 50 as PageSize }),
    ).rejects.toThrow(/page size/);
  });

  it('returns real products and totalCount', async () => {
    const page = fixture('search-milk-category-casey.json');
    const { c } = client(async () => json(200, page));
    const result = await c.searchPage({ offset: 0, limit: 60 });
    expect(result.totalCount).toBe(21);
    expect(result.products).toHaveLength(21);
  });

  it('throttles to at most one request per minIntervalMs', async () => {
    const { fetchImpl } = fakeAldi({ tree, byCategory: {} });
    const { c, clock } = client(fetchImpl, { minIntervalMs: 1000 });
    await c.searchPage({ offset: 0, limit: 12 });
    await c.searchPage({ offset: 12, limit: 12 });
    await c.searchPage({ offset: 24, limit: 12 });
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it('retries 5xx and 429 with exponential backoff, honouring Retry-After', async () => {
    const responses = [
      () => json(503, {}),
      () => json(429, {}, { 'retry-after': '7' }),
      () => json(200, fixture('search-q-banana-casey.json')),
    ];
    let i = 0;
    const { c, clock } = client(async () => responses[i++]!(), {
      minIntervalMs: 0,
      backoffBaseMs: 1000,
    });
    const result = await c.searchPage({ offset: 0, limit: 12 });
    expect(result.products.length).toBeGreaterThan(0);
    expect(clock.sleeps).toEqual([1000, 7000]);
    expect(c.requestCount).toBe(3);
  });

  it('retries network errors then gives up', async () => {
    const { c } = client(
      async () => {
        throw new TypeError('fetch failed');
      },
      { maxRetries: 2, minIntervalMs: 0 },
    );
    await expect(c.getCategoryTree()).rejects.toThrow('fetch failed');
    expect(c.requestCount).toBe(3);
  });

  it('treats a 403 (Akamai) as blocked and does not retry', async () => {
    const html = fixtureText('akamai-access-denied.html');
    const { c } = client(
      async () => new Response(html, { status: 403, headers: { 'content-type': 'text/html' } }),
    );
    await expect(c.getCategoryTree()).rejects.toBeInstanceOf(AldiBlockedError);
    expect(c.requestCount).toBe(1);
  });

  it('treats a 200 HTML page as blocked', async () => {
    const { c } = client(
      async () =>
        new Response('<html>challenge</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    await expect(c.getCategoryTree()).rejects.toBeInstanceOf(AldiBlockedError);
  });

  it('does not retry 400s (real error bodies)', async () => {
    const { c } = client(async () => json(400, fixture('error-merchant-not-found.json')));
    const err = await c.searchPage({ offset: 0, limit: 12 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AldiHttpError);
    expect(String(err)).toContain('Merchant not found');
    expect(c.requestCount).toBe(1);
  });

  it('rejects unexpected shapes', async () => {
    const { c } = client(async () => json(200, { data: [{ nope: true }] }));
    await expect(c.getCategoryTree()).rejects.toBeInstanceOf(AldiShapeError);
    const { c: c2 } = client(async () => json(200, { data: [] }));
    await expect(c2.searchPage({ offset: 0, limit: 12 })).rejects.toBeInstanceOf(AldiShapeError);
  });

  it('enforces the request budget', async () => {
    const { fetchImpl } = fakeAldi({ tree, byCategory: {} });
    const { c } = client(fetchImpl, { maxRequests: 2 });
    await c.searchPage({ offset: 0, limit: 12 });
    await c.searchPage({ offset: 0, limit: 12 });
    await expect(c.searchPage({ offset: 0, limit: 12 })).rejects.toBeInstanceOf(
      RequestBudgetExceededError,
    );
  });
});

describe('pageSizeFor', () => {
  it('picks the smallest allowed page size that fits', () => {
    expect(pageSizeFor(undefined)).toBe(60);
    expect(pageSizeFor(10)).toBe(12);
    expect(pageSizeFor(20)).toBe(24);
    expect(pageSizeFor(500)).toBe(60);
  });
});
