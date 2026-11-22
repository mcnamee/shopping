import type { CatalogueProduct } from '@trolley/core';
import { describe, expect, it } from 'vitest';
import { AldiClient } from '../src/aldi-client';
import type { AldiProduct } from '../src/aldi-types';
import { crawlCatalogue } from '../src/crawl';
import { runScrape, ScrapeFailedError } from '../src/run';
import type { CatalogueStore, ScrapeRunRecord } from '../src/store';
import {
  ALL_FIXTURE_PRODUCTS,
  fakeAldi,
  fixtureText,
  node,
  productLike,
  virtualClock,
} from './fake-aldi';

const DAIRY = node('960000000', 'Dairy, Eggs & Fridge', 'dairy-eggs-fridge');
const PANTRY = node('970000000', 'Pantry', 'pantry');
const XMAS = node('1588161420755355', 'Christmas', 'christmas');
const TREE = [XMAS, DAIRY, PANTRY];

const template = ALL_FIXTURE_PRODUCTS.find((p) => p.name === 'Light Milk 2L')!;
const make = (prefix: string, n: number): AldiProduct[] =>
  Array.from({ length: n }, (_, i) =>
    productLike(template, `${prefix}${String(i).padStart(4, '0')}`, {
      name: `Product ${prefix}-${i} 1L`,
    }),
  );

function setup(
  byCategory: Record<string, AldiProduct[]>,
  override?: Parameters<typeof fakeAldi>[0]['override'],
) {
  const fake = fakeAldi({ tree: TREE, byCategory, ...(override ? { override } : {}) });
  const clock = virtualClock();
  const client = new AldiClient({
    fetchImpl: fake.fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0,
  });
  return { fake, client };
}

describe('crawlCatalogue', () => {
  it('pages each category to the end and dedupes by SKU across categories', async () => {
    const dairy = make('1', 130);
    const pantry = make('2', 61);
    const xmas = [dairy[0]!, pantry[5]!, ...make('3', 2)]; // overlaps
    const { client, fake } = setup({ [XMAS.key]: xmas, [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    const result = await crawlCatalogue(client);
    expect(result.complete).toBe(true);
    expect(result.products).toHaveLength(130 + 61 + 2);
    expect(new Set(result.products.map((p) => p.sku)).size).toBe(193);
    expect(result.expectedTotal).toBe(4 + 130 + 61);
    const dairyStat = result.categories.find((c) => c.key === DAIRY.key)!;
    expect(dairyStat).toMatchObject({ totalCount: 130, fetched: 130 });
    // tree + total + xmas(1) + dairy(3 pages) + pantry(2 pages)
    expect(fake.calls).toHaveLength(1 + 1 + 1 + 3 + 2);
    const offsets = fake.calls
      .filter((u) => u.searchParams.get('categoryKey') === DAIRY.key)
      .map((u) => u.searchParams.get('offset'));
    expect(offsets).toEqual(['0', '60', '120']);
  });

  it('stops on an empty page even if totalCount is wrong', async () => {
    const { client } = setup({ [DAIRY.key]: make('1', 10) }, (_n, url) => {
      if (
        url.searchParams.get('categoryKey') === DAIRY.key &&
        url.searchParams.get('offset') === '0'
      ) {
        return new Response(
          JSON.stringify({
            meta: { pagination: { offset: 0, limit: 60, totalCount: 9999 } },
            data: make('1', 60),
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return undefined;
    });
    const result = await crawlCatalogue(client, { categoryKeys: [DAIRY.key] });
    expect(result.products).toHaveLength(60);
  });

  it('marks the crawl incomplete for subsets and caps', async () => {
    const { client } = setup({ [DAIRY.key]: make('1', 30), [PANTRY.key]: make('2', 30) });
    const subset = await crawlCatalogue(client, { categoryKeys: [DAIRY.key] });
    expect(subset.complete).toBe(false);
    expect(subset.products).toHaveLength(30);

    const capped = await crawlCatalogue(client, { maxPerCategory: 12, pageSize: 12 });
    expect(capped.complete).toBe(false);
    expect(capped.stoppedReason).toBe('per-category cap');
    expect(capped.products).toHaveLength(24);

    const productCap = await crawlCatalogue(client, { maxProducts: 40 });
    expect(productCap.complete).toBe(false);
    expect(productCap.products).toHaveLength(40);

    const pageCap = await crawlCatalogue(client, { maxPagesPerCategory: 1, pageSize: 12 });
    expect(pageCap.complete).toBe(false);
  });

  it('aborts the whole crawl when blocked mid-way', async () => {
    const html = fixtureText('akamai-access-denied.html');
    const { client, fake } = setup(
      { [DAIRY.key]: make('1', 100), [PANTRY.key]: make('2', 10) },
      (n) =>
        n === 4
          ? new Response(html, { status: 403, headers: { 'content-type': 'text/html' } })
          : undefined,
    );
    const result = await crawlCatalogue(client);
    expect(result.complete).toBe(false);
    expect(result.stoppedReason).toBe('blocked');
    expect(fake.calls).toHaveLength(4); // no further requests after the block
  });

  it('continues with other categories after a non-fatal error', async () => {
    const { client } = setup(
      { [DAIRY.key]: make('1', 10), [PANTRY.key]: make('2', 10) },
      (_n, url) =>
        url.searchParams.get('categoryKey') === DAIRY.key
          ? new Response('{"errors":[]}', {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          : undefined,
    );
    const result = await crawlCatalogue(client);
    expect(result.complete).toBe(false);
    expect(result.products).toHaveLength(10);
    expect(result.errors[0]).toContain(DAIRY.key);
  });

  it('stops at the deadline', async () => {
    const { client } = setup({ [DAIRY.key]: make('1', 10) });
    const result = await crawlCatalogue(client, { shouldStop: () => true });
    expect(result).toMatchObject({ complete: false, stoppedReason: 'deadline', products: [] });
  });
});

class MemoryStore implements CatalogueStore {
  products = new Map<string, CatalogueProduct>();
  runs: ScrapeRunRecord[] = [];
  writes = 0;
  async loadProducts() {
    return [...this.products.values()].map((p) => structuredClone(p));
  }
  async writeProducts(products: readonly CatalogueProduct[]) {
    this.writes += products.length;
    for (const p of products) this.products.set(p.sku, structuredClone(p));
  }
  async putRun(run: ScrapeRunRecord) {
    this.runs.push(run);
  }
}

describe('runScrape', () => {
  let day = 1;
  const at = () => {
    const d = new Date(Date.UTC(2026, 11, day));
    return () => d;
  };

  async function scrape(
    store: MemoryStore,
    byCategory: Record<string, AldiProduct[]>,
    override?: Parameters<typeof setup>[1],
  ) {
    day++;
    const { client } = setup(byCategory, override);
    return runScrape({ client, store, servicePoint: 'G526', now: at(), trigger: 'test' });
  }

  it('upserts, counts missed runs, discontinues after 2 complete misses, reactivates, never deletes', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 20);
    const pantry = make('2', 20);

    const r1 = await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    expect(r1.run).toMatchObject({
      status: 'success',
      created: 40,
      updated: 0,
      fetched: 40,
      discontinueStep: 'applied',
    });
    expect(store.products.size).toBe(40);
    const first = store.products.get(dairy[0]!.sku)!;
    expect(first).toMatchObject({
      missedRuns: 0,
      discontinued: false,
      groupId: 'dairy-eggs',
      storeId: 'G526',
    });

    // Run 2: one product missing
    const r2 = await scrape(store, { [DAIRY.key]: dairy.slice(1), [PANTRY.key]: pantry });
    expect(r2.run).toMatchObject({
      status: 'success',
      created: 0,
      updated: 39,
      missed: 1,
      discontinued: 0,
    });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 1, discontinued: false });
    expect(store.products.get(dairy[1]!.sku)!.firstSeenAt).toBe(first.firstSeenAt);

    // Run 3: still missing -> discontinued (kept)
    const r3 = await scrape(store, { [DAIRY.key]: dairy.slice(1), [PANTRY.key]: pantry });
    expect(r3.run).toMatchObject({ missed: 1, discontinued: 1 });
    const gone = store.products.get(dairy[0]!.sku)!;
    expect(gone).toMatchObject({ missedRuns: 2, discontinued: true });
    expect(gone.discontinuedAt).toBeDefined();
    expect(store.products.size).toBe(40);

    // Run 4: already discontinued products are not rewritten
    const writesBefore = store.writes;
    const r4 = await scrape(store, { [DAIRY.key]: dairy.slice(1), [PANTRY.key]: pantry });
    expect(r4.run).toMatchObject({ missed: 0, discontinued: 0 });
    expect(store.writes - writesBefore).toBe(39);

    // Run 5: it comes back
    const r5 = await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    expect(r5.run.reactivated).toBe(1);
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 0, discontinued: false });
    expect(store.runs.map((r) => r.status)).toEqual([
      'success',
      'success',
      'success',
      'success',
      'success',
    ]);
  });

  it('fails loudly and skips the discontinue step when < 50% of the previous count is fetched', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 50);
    const pantry = make('2', 50);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });

    const err = await scrape(store, { [DAIRY.key]: dairy.slice(0, 49), [PANTRY.key]: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ScrapeFailedError);
    const run = (err as ScrapeFailedError).run;
    expect(run).toMatchObject({
      status: 'failed',
      fetched: 49,
      previousActive: 100,
      discontinueStep: 'skipped',
      missed: 0,
    });
    expect(run.message).toMatch(/below 50%/);
    expect(store.runs.at(-1)!.status).toBe('failed');
    // Nothing was marked missed or discontinued
    expect([...store.products.values()].every((p) => p.missedRuns === 0 && !p.discontinued)).toBe(
      true,
    );
  });

  it('accepts a drop to exactly 50%', async () => {
    day = 1;
    const store = new MemoryStore();
    await scrape(store, { [DAIRY.key]: make('1', 50), [PANTRY.key]: make('2', 50) });
    const r = await scrape(store, { [DAIRY.key]: make('1', 50), [PANTRY.key]: [] });
    expect(r.run).toMatchObject({ status: 'success', missed: 50 });
  });

  it('skips the discontinue step and fails when the crawl is incomplete (bot block)', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 10);
    const pantry = make('2', 10);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    const html = fixtureText('akamai-access-denied.html');
    const err = await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry }, (_n, url) =>
      url.searchParams.get('categoryKey') === PANTRY.key
        ? new Response(html, { status: 403 })
        : undefined,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScrapeFailedError);
    expect((err as ScrapeFailedError).run).toMatchObject({
      status: 'partial',
      discontinueStep: 'skipped',
      updated: 10,
      missed: 0,
    });
    expect([...store.products.values()].every((p) => p.missedRuns === 0)).toBe(true);
  });

  it('records a failed run when blocked before any data', async () => {
    day = 1;
    const store = new MemoryStore();
    const err = await scrape(store, {}, () => new Response('denied', { status: 403 })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ScrapeFailedError);
    expect(store.runs[0]).toMatchObject({ status: 'failed', fetched: 0 });
    expect(store.products.size).toBe(0);
  });

  it('fails when nothing is fetched on a first run', async () => {
    day = 1;
    const store = new MemoryStore();
    await expect(scrape(store, { [DAIRY.key]: [], [PANTRY.key]: [] })).rejects.toThrow(
      /No products fetched/,
    );
  });

  it('dry run writes nothing and reports distributions', async () => {
    const { client } = setup({ [DAIRY.key]: ALL_FIXTURE_PRODUCTS.slice(0, 30) });
    const result = await runScrape({ client, servicePoint: 'G526' });
    expect(result.run.message).toMatch(/Dry run/);
    expect(result.products.length).toBe(30);
    expect(Object.values(result.run.unitTypes).reduce((a, b) => a + b, 0)).toBe(30);
  });
});
