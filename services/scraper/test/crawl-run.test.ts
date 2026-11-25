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
  LIQUOR_FIXTURE_PRODUCTS,
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
  servicePoint?: Parameters<typeof fakeAldi>[0]['servicePoint'],
) {
  const fake = fakeAldi({
    tree: TREE,
    byCategory,
    ...(override ? { override } : {}),
    ...(servicePoint ? { servicePoint } : {}),
  });
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
    this.runs.push(structuredClone(run));
  }
  async lastSuccessfulRun() {
    return [...this.runs].reverse().find((r) => r.status === 'succeeded') ?? null;
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

  const failure = async (p: Promise<unknown>) => {
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScrapeFailedError);
    return (err as ScrapeFailedError).run;
  };

  it('flags spirits as notAtStore using the store licence, and keeps them stored', async () => {
    day = 1;
    const store = new MemoryStore();
    const whisky = LIQUOR_FIXTURE_PRODUCTS.find((p) => p.name === 'Blended Scotch Whisky 700ml')!;
    const ale = LIQUOR_FIXTURE_PRODUCTS.find((p) => p.name === 'Pacific Ale 12x330ml')!;
    const { client } = setup({ [DAIRY.key]: [...make('1', 2), whisky, ale] }, undefined, {
      id: 'G526',
      alcoholAvailability: ['Beer', 'Wine'],
    });
    const r = await runScrape({
      client,
      store,
      servicePoint: 'G526',
      now: () => new Date(Date.UTC(2026, 11, 2)),
      trigger: 'test',
    });
    expect(r.run).toMatchObject({ notAtStore: 1, alcoholAvailability: ['Beer', 'Wine'] });
    const all = await store.loadProducts();
    expect(all.find((p) => p.sku === whisky.sku)).toMatchObject({ notAtStore: true });
    expect(all.find((p) => p.sku === ale.sku)).toMatchObject({ notAtStore: false });
  });

  it('carries on (flagging no liquor) when the service point cannot be read', async () => {
    day = 1;
    const store = new MemoryStore();
    const whisky = LIQUOR_FIXTURE_PRODUCTS.find((p) => p.name === 'Blended Scotch Whisky 700ml')!;
    const { client } = setup({ [DAIRY.key]: [...make('1', 2), whisky] }); // service point 404s
    const r = await runScrape({
      client,
      store,
      servicePoint: 'G526',
      now: () => new Date(Date.UTC(2026, 11, 2)),
      trigger: 'test',
    });
    expect(r.run.status).toBe('succeeded');
    expect(r.run.notAtStore).toBe(0);
    expect(r.run.alcoholAvailability).toBeNull();
  });

  it('flags upcoming Special Buys notAtStore, keeps them, and clears the flag once on sale', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 3);
    dairy[0] = { ...dairy[0]!, onSaleDate: '2026-12-20', onSaleDateDisplay: 'On Sale Sun 20 Dec' };

    const r1 = await scrape(store, { [DAIRY.key]: dairy }); // run date 2026-12-02
    expect(r1.run.notAtStore).toBe(1);
    const stored = (await store.loadProducts()).find((p) => p.sku === dairy[0]!.sku)!;
    expect(stored).toMatchObject({
      notAtStore: true,
      onSaleDate: '2026-12-20',
      discontinued: false,
    });

    day = 20; // next run lands on the on-sale date
    const r2 = await scrape(store, { [DAIRY.key]: dairy });
    expect(r2.run.notAtStore).toBe(0);
    expect(r2.run.updated).toBe(1);
    const after = (await store.loadProducts()).find((p) => p.sku === dairy[0]!.sku)!;
    expect(after.notAtStore).toBe(false);
  });

  it('upserts, counts missed runs, soft-removes after 2 successful misses, restores on return', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 20);
    const pantry = make('2', 20);

    const r1 = await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    expect(r1.run).toMatchObject({
      status: 'succeeded',
      new: 40,
      updated: 0,
      unchanged: 0,
      fetched: 40,
      baseline: null,
      store: 'G526',
      discontinueStep: 'applied',
      removed: 0,
    });
    expect(store.products.size).toBe(40);
    const first = store.products.get(dairy[0]!.sku)!;
    expect(first).toMatchObject({ missedRuns: 0, discontinued: false, groupId: 'dairy-eggs' });

    // Run 2: one product missing, one price change
    const changed = dairy.slice(1).map((p, i) => (i === 0 ? { ...p, price: { amount: 999 } } : p));
    const r2 = await scrape(store, { [DAIRY.key]: changed, [PANTRY.key]: pantry });
    expect(r2.run).toMatchObject({
      status: 'succeeded',
      updated: 1,
      unchanged: 38,
      missed: 1,
      removed: 0,
    });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 1, discontinued: false });
    expect(store.products.get(dairy[1]!.sku)!.firstSeenAt).toBe(first.firstSeenAt);

    // Run 3: still missing -> soft-removed (flagged, never deleted)
    const r3 = await scrape(store, { [DAIRY.key]: changed, [PANTRY.key]: pantry });
    expect(r3.run).toMatchObject({ status: 'succeeded', missed: 1, removed: 1 });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({
      missedRuns: 2,
      discontinued: true,
      discontinuedAt: store.runs.at(-1)!.startedAt,
    });
    expect(store.products.size).toBe(40);

    // Run 4: already removed and still gone: left alone, not counted again
    const r4 = await scrape(store, { [DAIRY.key]: changed, [PANTRY.key]: pantry });
    expect(r4.run).toMatchObject({ missed: 0, removed: 0 });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ discontinued: true });

    // Run 5: it comes back -> restored automatically
    const r5 = await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    expect(r5.run).toMatchObject({ new: 0, reactivated: 1, removed: 0 });
    const restored = store.products.get(dairy[0]!.sku)!;
    expect(restored).toMatchObject({ missedRuns: 0, discontinued: false });
    expect(restored.discontinuedAt).toBeUndefined();
    expect(restored.firstSeenAt).toBe(first.firstSeenAt);
  });

  it('does not remove on the first miss, and a product seen again resets its count', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 40);
    await scrape(store, { [DAIRY.key]: dairy });
    await scrape(store, { [DAIRY.key]: dairy.slice(1) });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 1, discontinued: false });
    await scrape(store, { [DAIRY.key]: dairy });
    await scrape(store, { [DAIRY.key]: dairy.slice(1) });
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 1, discontinued: false });
  });

  it('never removes on a failed (incomplete) run, even for products already missed once', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 30);
    const pantry = make('2', 10);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    await scrape(store, { [DAIRY.key]: dairy.slice(1), [PANTRY.key]: pantry }); // missedRuns 1
    const html = fixtureText('akamai-access-denied.html');
    await failure(
      scrape(store, { [DAIRY.key]: dairy.slice(1), [PANTRY.key]: pantry }, (_n, url) =>
        url.searchParams.get('categoryKey') === PANTRY.key
          ? new Response(html, { status: 403 })
          : undefined,
      ),
    );
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 1, discontinued: false });
    expect([...store.products.values()].filter((p) => p.discontinued)).toEqual([]);
  });

  it('skips the removal step above 25% of the active catalogue: fails loudly, flags nothing', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 40);
    const pantry = make('2', 40);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    // Run 2: 30 of 80 go missing (below 50% abort threshold, miss count 1, none removed yet)
    const kept = dairy.slice(30);
    await scrape(store, { [DAIRY.key]: kept, [PANTRY.key]: pantry });
    // Run 3: they would all be removed (30/80 = 37.5% > 25%)
    const run = await failure(scrape(store, { [DAIRY.key]: kept, [PANTRY.key]: pantry }));
    expect(run).toMatchObject({ status: 'failed', discontinueStep: 'skipped', removed: 0 });
    expect(run.message).toMatch(/Removal step aborted: 30 of 80/);
    expect(store.products.size).toBe(80);
    expect(store.products.get(dairy[0]!.sku)).toMatchObject({ missedRuns: 2, discontinued: false });
    expect(store.products.get(dairy[0]!.sku)!.discontinuedAt).toBeUndefined();
  });

  it('removes exactly at the 25% cap', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 80);
    const pantry = make('2', 20);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    const kept = dairy.slice(25);
    await scrape(store, { [DAIRY.key]: kept, [PANTRY.key]: pantry });
    const r = await scrape(store, { [DAIRY.key]: kept, [PANTRY.key]: pantry });
    expect(r.run).toMatchObject({ status: 'succeeded', removed: 25 });
    expect(store.products.size).toBe(100);
    expect([...store.products.values()].filter((p) => p.discontinued)).toHaveLength(25);
  });

  it('aborts with no writes when < 50% of the previous successful run is fetched', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 50);
    const pantry = make('2', 50);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    const before = structuredClone([...store.products.values()]);
    const writes = store.writes;

    const changed = dairy.slice(0, 49).map((p) => ({ ...p, price: { amount: 1 } }));
    const run = await failure(scrape(store, { [DAIRY.key]: changed, [PANTRY.key]: [] }));
    expect(run).toMatchObject({
      status: 'aborted',
      fetched: 49,
      baseline: 100,
      discontinueStep: 'skipped',
      missed: 0,
    });
    expect(run.message).toMatch(/below 50%/);
    expect(store.runs.at(-1)!.status).toBe('aborted');
    expect(store.writes).toBe(writes);
    expect([...store.products.values()]).toEqual(before);
  });

  it('compares against the last successful run, not an aborted one', async () => {
    day = 1;
    const store = new MemoryStore();
    await scrape(store, { [DAIRY.key]: make('1', 100) });
    await failure(scrape(store, { [DAIRY.key]: make('1', 10) }));
    // 49 is still < 50% of 100 (the last success), not of the aborted 10
    const run = await failure(scrape(store, { [DAIRY.key]: make('1', 49) }));
    expect(run).toMatchObject({ status: 'aborted', baseline: 100 });
  });

  it('accepts a drop to exactly 50%', async () => {
    day = 1;
    const store = new MemoryStore();
    await scrape(store, { [DAIRY.key]: make('1', 50), [PANTRY.key]: make('2', 50) });
    const r = await scrape(store, { [DAIRY.key]: make('1', 50), [PANTRY.key]: [] });
    expect(r.run).toMatchObject({ status: 'succeeded', missed: 50 });
  });

  it('falls back to the active product count when there are no run records', async () => {
    day = 1;
    const store = new MemoryStore();
    await scrape(store, { [DAIRY.key]: make('1', 100) });
    store.runs = [];
    const run = await failure(scrape(store, { [DAIRY.key]: make('1', 10) }));
    expect(run).toMatchObject({ status: 'aborted', baseline: 100 });
  });

  it('fails, updates seen products and skips the removal step on an incomplete crawl (bot block)', async () => {
    day = 1;
    const store = new MemoryStore();
    const dairy = make('1', 30);
    const pantry = make('2', 10);
    await scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry });
    const html = fixtureText('akamai-access-denied.html');
    const run = await failure(
      scrape(store, { [DAIRY.key]: dairy, [PANTRY.key]: pantry }, (_n, url) =>
        url.searchParams.get('categoryKey') === PANTRY.key
          ? new Response(html, { status: 403 })
          : undefined,
      ),
    );
    expect(run).toMatchObject({
      status: 'failed',
      discontinueStep: 'skipped',
      unchanged: 30,
      missed: 0,
      errors: 1,
    });
    expect([...store.products.values()].every((p) => p.missedRuns === 0)).toBe(true);
  });

  it('records a failed run when blocked before any data', async () => {
    day = 1;
    const store = new MemoryStore();
    const run = await failure(scrape(store, {}, () => new Response('denied', { status: 403 })));
    expect(run).toMatchObject({ status: 'failed', fetched: 0, errors: 1 });
    expect(store.runs[0]!.status).toBe('failed');
    expect(store.products.size).toBe(0);
  });

  it('fails when nothing is fetched on a first run', async () => {
    day = 1;
    const store = new MemoryStore();
    const run = await failure(scrape(store, { [DAIRY.key]: [], [PANTRY.key]: [] }));
    expect(run.message).toMatch(/No products fetched/);
  });

  it('dry run writes nothing and reports distributions', async () => {
    const { client } = setup({ [DAIRY.key]: ALL_FIXTURE_PRODUCTS.slice(0, 30) });
    const result = await runScrape({ client, servicePoint: 'G526' });
    expect(result.run.message).toMatch(/Dry run/);
    expect(result.products.length).toBe(30);
    expect(Object.values(result.run.unitTypes).reduce((a, b) => a + b, 0)).toBe(30);
  });
});
