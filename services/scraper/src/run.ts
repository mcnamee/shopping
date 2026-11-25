/**
 * One scrape run: crawl -> map -> (unless dry run) upsert, soft-remove, record.
 *
 * Safety rules (spec 3.1/4, Stage 1 A5-A8, D-028, D-123):
 *   - NOTHING IS EVER DELETED (D-123 supersedes D-122). A product missing from 2
 *     consecutive successful, complete runs (missedRuns >= 2) is flagged `discontinued`
 *     with `discontinuedAt` ("removed"); every read path then hides it, but its item (and
 *     list/template snapshots) stay. Seeing it again in any later run restores it
 *     (flag and timestamp cleared, missedRuns 0);
 *   - REMOVAL CAP: if a run would remove more than 25% of the active catalogue, the removal
 *     step is skipped, nothing is flagged, the run is `failed` and it throws;
 *   - ABORTED: if a run fetches < 50% of the previous successful run's product count
 *     (bot block, API change), it writes NO product changes, removes nothing,
 *     records status `aborted` and throws (-> Lambda error -> alarm email). The first
 *     run is exempt;
 *   - FAILED: if the crawl is incomplete (bot block mid-way, error, deadline, cap) or
 *     returns nothing, freshly seen products are upserted but the removal step is
 *     skipped; status `failed` and it throws.
 */
import { allowedAlcohol, storeToday, type CatalogueProduct } from '@trolley/core';
import type { AldiClient } from './aldi-client';
import { crawlCatalogue, type CrawlOptions, type CrawlResult } from './crawl';
import { mapProduct, type MappedProduct } from './map-product';
import type { CatalogueStore, ScrapeRunRecord } from './store';

export const REMOVE_AFTER_MISSED_RUNS = 2;
export const DEFAULT_SAFETY_RATIO = 0.5;
/** Max share of the active catalogue one run may remove. */
export const DEFAULT_MAX_REMOVE_RATIO = 0.25;

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
  maxRemoveRatio?: number;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
}

export interface RunResult {
  run: ScrapeRunRecord;
  /** Mapped products (the CLI writes them out for dry runs). */
  products: MappedProduct[];
  crawl: Omit<CrawlResult, 'products'>;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/** Fields whose change makes a product "updated" rather than "unchanged". */
function sameContent(a: CatalogueProduct, b: Omit<MappedProduct, 'groupVia'>): boolean {
  return (
    a.name === b.name &&
    a.brand === b.brand &&
    a.packSize === b.packSize &&
    a.unitType === b.unitType &&
    a.price === b.price &&
    a.unitPrice === b.unitPrice &&
    a.imageUrl === b.imageUrl &&
    a.groupId === b.groupId &&
    a.storeId === b.storeId &&
    (a.notAtStore ?? false) === (b.notAtStore ?? false) &&
    a.onSaleDate === b.onSaleDate &&
    JSON.stringify(a.categories) === JSON.stringify(b.categories)
  );
}

export async function runScrape(options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const started = now();
  const startedAt = started.toISOString();
  const today = storeToday(started);
  const safetyRatio = options.safetyRatio ?? DEFAULT_SAFETY_RATIO;
  const maxRemoveRatio = options.maxRemoveRatio ?? DEFAULT_MAX_REMOVE_RATIO;

  const run: ScrapeRunRecord = {
    startedAt,
    finishedAt: startedAt,
    status: 'failed',
    trigger: options.trigger ?? 'unknown',
    store: options.servicePoint,
    durationMs: 0,
    requests: 0,
    expectedTotal: null,
    baseline: null,
    fetched: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
    missed: 0,
    removed: 0,
    errors: 0,
    discontinueStep: 'skipped',
    notAtStore: 0,
    alcoholAvailability: null,
    unmappedCategories: {},
    unitTypes: {},
    errorMessages: [],
  };
  const finish = async (status: ScrapeRunRecord['status'], message?: string) => {
    run.status = status;
    if (message) run.message = message;
    run.finishedAt = now().toISOString();
    run.durationMs = now().getTime() - started.getTime();
    run.requests = options.client.requestCount;
    run.errors = run.errorMessages.length;
    if (options.store) await options.store.putRun(run);
  };

  // The store's liquor licence (one request). Unknown (error) means nothing is hidden for it.
  let alcohol: ReturnType<typeof allowedAlcohol> | null = null;
  try {
    const sp = await options.client.getServicePoint();
    if (sp?.alcoholAvailability) {
      run.alcoholAvailability = sp.alcoholAvailability;
      alcohol = allowedAlcohol(sp.alcoholAvailability);
    }
  } catch (err) {
    log({ level: 'warn', msg: 'could not read store alcohol availability', error: String(err) });
  }

  let crawl: CrawlResult;
  try {
    crawl = await crawlCatalogue(options.client, { ...options.crawl, log });
  } catch (err) {
    run.errorMessages.push(String(err));
    await finish('failed', 'Crawl failed before any data was fetched');
    throw new ScrapeFailedError(`${run.message}: ${String(err)}`, run);
  }

  const mapped = crawl.products
    .map((p) => mapProduct(p, options.servicePoint, { today, alcohol }))
    .filter((p): p is MappedProduct => p !== null);
  const { products: _raw, ...crawlInfo } = crawl;
  run.expectedTotal = crawl.expectedTotal;
  run.fetched = mapped.length;
  run.unmappedCategories = countBy(
    mapped.filter((p) => p.groupVia === 'unmapped'),
    (p) => p.categories.map((c) => c.name).join(' > ') || '(no category)',
  );
  run.unitTypes = countBy(mapped, (p) => p.unitType);
  run.notAtStore = mapped.filter((p) => p.notAtStore).length;
  run.errorMessages = crawl.errors.slice(0, 20);

  if (!options.store) {
    await finish(crawl.complete ? 'succeeded' : 'failed', 'Dry run: nothing written');
    return { run, products: mapped, crawl: crawlInfo };
  }
  const store = options.store;

  const existing = new Map((await store.loadProducts()).map((p) => [p.sku, p]));
  const lastSuccess = await store.lastSuccessfulRun();
  // Baseline: the previous successful run's count; if run records were lost, the number
  // of active products. Null (first run) disables the check.
  const activeCount = [...existing.values()].filter((p) => !p.discontinued).length;
  run.baseline = lastSuccess?.fetched ?? (activeCount > 0 ? activeCount : null);

  if (run.baseline && mapped.length < run.baseline * safetyRatio) {
    const message =
      `Aborted: fetched ${mapped.length} products, below ${Math.round(safetyRatio * 100)}% ` +
      `of the previous ${run.baseline}. Nothing was written.`;
    await finish('aborted', message);
    throw new ScrapeFailedError(message, run);
  }

  const ts = startedAt;
  const toWrite: CatalogueProduct[] = [];
  const seen = new Set<string>();
  for (const m of mapped) {
    const { groupVia: _via, ...fields } = m;
    const prev = existing.get(m.sku);
    seen.add(m.sku);
    if (!prev) run.new++;
    else if (prev.discontinued) run.reactivated++;
    else if (sameContent(prev, fields) && prev.missedRuns === 0) run.unchanged++;
    else run.updated++;
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
  if (!crawl.complete) failures.push(`Incomplete crawl (${crawl.stoppedReason ?? 'unknown'})`);

  if (failures.length === 0) {
    run.discontinueStep = 'applied';
    const toRemove: CatalogueProduct[] = [];
    const missedOnly: CatalogueProduct[] = [];
    for (const prev of existing.values()) {
      if (seen.has(prev.sku) || prev.discontinued) continue; // already removed: leave as is
      const missedRuns = prev.missedRuns + 1;
      run.missed++;
      if (missedRuns >= REMOVE_AFTER_MISSED_RUNS) {
        toRemove.push({ ...prev, missedRuns, discontinued: true, discontinuedAt: ts });
      } else {
        missedOnly.push({ ...prev, missedRuns });
      }
    }
    toWrite.push(...missedOnly);
    if (toRemove.length > activeCount * maxRemoveRatio) {
      // Too many at once (likely a partial catalogue): keep them visible, count the misses.
      failures.push(
        `Removal step aborted: ${toRemove.length} of ${activeCount} products would be removed, ` +
          `above ${Math.round(maxRemoveRatio * 100)}%`,
      );
      run.discontinueStep = 'skipped';
      toWrite.push(
        ...toRemove.map(({ discontinued: _d, discontinuedAt: _a, ...p }) => ({
          ...p,
          discontinued: false,
        })),
      );
    } else {
      toWrite.push(...toRemove);
      run.removed = toRemove.length;
    }
  }

  log({ level: 'info', msg: 'writing products', count: toWrite.length });
  await store.writeProducts(toWrite, ts);

  if (failures.length) {
    const message = `${failures.join('; ')}. Seen products updated; nothing removed.`;
    await finish('failed', message);
    throw new ScrapeFailedError(message, run);
  }
  await finish('succeeded');
  return { run, products: mapped, crawl: crawlInfo };
}
