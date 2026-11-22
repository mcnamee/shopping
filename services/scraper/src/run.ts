/**
 * One scrape run: crawl -> map -> (unless dry run) upsert, discontinue, record.
 *
 * Safety rules (spec 3.1, 4):
 *   - products are never deleted;
 *   - a product is marked discontinued only after it is missing from 2 consecutive
 *     COMPLETE runs (missedRuns >= 2);
 *   - if the crawl is incomplete (cap, deadline, error, bot block) the discontinue step
 *     is skipped and the run fails loudly;
 *   - if a run fetches < 50% of the previously active product count, the discontinue
 *     step is skipped and the run fails loudly (protects against bot-blocking or an API
 *     change silently wiping the catalogue).
 * Seen products are still upserted in the failure cases: they are real, fresh data.
 */
import type { CatalogueProduct } from '@trolley/core';
import type { AldiClient } from './aldi-client';
import { crawlCatalogue, type CrawlOptions, type CrawlResult } from './crawl';
import { mapProduct, type MappedProduct } from './map-product';
import type { CatalogueStore, ScrapeRunRecord } from './store';

export const DISCONTINUE_AFTER_MISSED_RUNS = 2;
export const DEFAULT_SAFETY_RATIO = 0.5;

export class ScrapeFailedError extends Error {
  override name = 'ScrapeFailedError';
  constructor(
    message: string,
    public readonly run: ScrapeRunRecord,
  ) {
    super(message);
  }
}

export interface RunOptions {
  client: AldiClient;
  servicePoint: string | null;
  /** Omit for a dry run (no persistence). */
  store?: CatalogueStore;
  crawl?: CrawlOptions;
  trigger?: string;
  safetyRatio?: number;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
}

export interface RunResult {
  run: ScrapeRunRecord;
  /** Mapped products (always returned; the CLI writes them for dry runs). */
  products: MappedProduct[];
  crawl: Omit<CrawlResult, 'products'>;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

export async function runScrape(options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const started = now();
  const startedAt = started.toISOString();
  const safetyRatio = options.safetyRatio ?? DEFAULT_SAFETY_RATIO;

  const baseRun = (): ScrapeRunRecord => ({
    startedAt,
    finishedAt: now().toISOString(),
    status: 'failed',
    trigger: options.trigger ?? 'unknown',
    servicePoint: options.servicePoint,
    durationMs: now().getTime() - started.getTime(),
    requests: options.client.requestCount,
    expectedTotal: null,
    fetched: 0,
    previousActive: 0,
    created: 0,
    updated: 0,
    reactivated: 0,
    missed: 0,
    discontinued: 0,
    discontinueStep: 'skipped',
    unmappedCategories: {},
    unitTypes: {},
    errors: [],
  });

  let crawl: CrawlResult;
  try {
    crawl = await crawlCatalogue(options.client, { ...options.crawl, log });
  } catch (err) {
    const run = {
      ...baseRun(),
      errors: [String(err)],
      message: 'Crawl failed before any data was fetched',
    };
    if (options.store) await options.store.putRun(run);
    throw new ScrapeFailedError(`${run.message}: ${String(err)}`, run);
  }

  const mapped = crawl.products
    .map((p) => mapProduct(p, options.servicePoint))
    .filter((p): p is MappedProduct => p !== null);
  const unmapped = countBy(
    mapped.filter((p) => p.groupVia === 'unmapped'),
    (p) => p.categories.map((c) => c.name).join(' > ') || '(no category)',
  );
  const { products: _raw, ...crawlInfo } = crawl;

  const run: ScrapeRunRecord = {
    ...baseRun(),
    expectedTotal: crawl.expectedTotal,
    fetched: mapped.length,
    unmappedCategories: unmapped,
    unitTypes: countBy(mapped, (p) => p.unitType),
    errors: crawl.errors.slice(0, 20),
  };

  if (!options.store) {
    run.status = crawl.complete ? 'success' : 'partial';
    run.message = 'Dry run: nothing written';
    return {
      run: { ...run, finishedAt: now().toISOString(), requests: options.client.requestCount },
      products: mapped,
      crawl: crawlInfo,
    };
  }

  const store = options.store;
  const existing = new Map((await store.loadProducts()).map((p) => [p.sku, p]));
  run.previousActive = [...existing.values()].filter((p) => !p.discontinued).length;

  const ts = startedAt;
  const toWrite: CatalogueProduct[] = [];
  const seen = new Set<string>();
  for (const m of mapped) {
    const { groupVia: _via, ...fields } = m;
    const prev = existing.get(m.sku);
    seen.add(m.sku);
    if (!prev) run.created++;
    else run.updated++;
    if (prev?.discontinued) run.reactivated++;
    toWrite.push({
      ...fields,
      firstSeenAt: prev?.firstSeenAt || ts,
      lastSeenAt: ts,
      missedRuns: 0,
      discontinued: false,
    });
  }

  const failures: string[] = [];
  if (mapped.length === 0) failures.push('No products fetched');
  if (run.previousActive > 0 && mapped.length < run.previousActive * safetyRatio) {
    failures.push(
      `Fetched ${mapped.length} products, below ${Math.round(safetyRatio * 100)}% of the ${run.previousActive} previously active`,
    );
  }
  if (!crawl.complete) failures.push(`Incomplete crawl (${crawl.stoppedReason ?? 'unknown'})`);

  if (failures.length === 0) {
    run.discontinueStep = 'applied';
    for (const prev of existing.values()) {
      if (seen.has(prev.sku) || prev.discontinued) continue;
      const missedRuns = prev.missedRuns + 1;
      run.missed++;
      const discontinue = missedRuns >= DISCONTINUE_AFTER_MISSED_RUNS;
      if (discontinue) run.discontinued++;
      toWrite.push({
        ...prev,
        missedRuns,
        discontinued: discontinue,
        ...(discontinue ? { discontinuedAt: ts } : {}),
      });
    }
  }

  log({ level: 'info', msg: 'writing products', count: toWrite.length });
  await store.writeProducts(toWrite, ts);

  run.status = failures.length === 0 ? 'success' : crawl.complete ? 'failed' : 'partial';
  if (failures.length) run.message = `${failures.join('; ')}. Discontinue step skipped.`;
  run.finishedAt = now().toISOString();
  run.durationMs = now().getTime() - started.getTime();
  run.requests = options.client.requestCount;
  await store.putRun(run);

  if (failures.length) throw new ScrapeFailedError(run.message ?? 'Scrape failed', run);
  return { run, products: mapped, crawl: crawlInfo };
}
