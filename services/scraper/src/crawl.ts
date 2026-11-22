/**
 * Crawl the ALDI catalogue by top-level category with offset paging, deduping by SKU.
 * Any cap, deadline or error makes the crawl `complete: false`; persistence then skips
 * the discontinue step so a partial crawl can never mark products discontinued.
 */
import {
  AldiBlockedError,
  RequestBudgetExceededError,
  type AldiClient,
  type PageSize,
} from './aldi-client';
import type { AldiCategoryNode, AldiProduct } from './aldi-types';

export interface CrawlOptions {
  pageSize?: PageSize;
  /** Only crawl these top-level category keys (dry runs / politeness caps). */
  categoryKeys?: readonly string[];
  /** Stop a category after this many products (dry runs). Marks the crawl incomplete. */
  maxPerCategory?: number;
  /** Stop everything after this many unique products. Marks the crawl incomplete. */
  maxProducts?: number;
  /** Safety: max pages per category (default 50 = 3000 products at 60/page). */
  maxPagesPerCategory?: number;
  /** Return true when time is up (e.g. Lambda remaining time < margin). */
  shouldStop?: () => boolean;
  log?: (event: Record<string, unknown>) => void;
}

export interface CategoryStat {
  key: string;
  name: string;
  totalCount: number | null;
  fetched: number;
  newUnique: number;
}

export interface CrawlResult {
  products: AldiProduct[];
  /** True only if every selected category was paged to the end without error or cap. */
  complete: boolean;
  /** Unfiltered catalogue size reported by ALDI (coverage check), if fetched. */
  expectedTotal: number | null;
  categories: CategoryStat[];
  errors: string[];
  stoppedReason: string | null;
}

export async function crawlCatalogue(
  client: AldiClient,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const pageSize = options.pageSize ?? 60;
  const maxPages = options.maxPagesPerCategory ?? 50;
  const maxProducts = options.maxProducts ?? 10_000;
  const log = options.log ?? (() => undefined);
  const bySku = new Map<string, AldiProduct>();
  const categories: CategoryStat[] = [];
  const errors: string[] = [];
  let complete = true;
  let stoppedReason: string | null = null;

  const stop = (reason: string) => {
    complete = false;
    stoppedReason ??= reason;
  };
  const fatal = (err: unknown) =>
    err instanceof AldiBlockedError || err instanceof RequestBudgetExceededError;

  // The tree is required: without it we can't crawl at all.
  const tree: AldiCategoryNode[] = await client.getCategoryTree();
  let selected = tree;
  if (options.categoryKeys) {
    const wanted = new Set(options.categoryKeys);
    selected = tree.filter((n) => wanted.has(n.key));
    complete = false; // a subset is never a full catalogue
    stoppedReason = 'category subset';
  }

  let expectedTotal: number | null = null;
  try {
    expectedTotal = (await client.searchPage({ offset: 0, limit: 12 })).totalCount;
  } catch (err) {
    if (fatal(err)) throw err;
    errors.push(`total count: ${String(err)}`);
  }

  outer: for (const node of selected) {
    const stat: CategoryStat = {
      key: node.key,
      name: node.name,
      totalCount: null,
      fetched: 0,
      newUnique: 0,
    };
    categories.push(stat);
    for (let page = 0; ; page++) {
      if (options.shouldStop?.()) {
        stop('deadline');
        break outer;
      }
      if (page >= maxPages) {
        stop(`page cap in ${node.name}`);
        errors.push(`page cap (${maxPages}) reached in category ${node.key}`);
        break;
      }
      let result: Awaited<ReturnType<AldiClient['searchPage']>>;
      try {
        result = await client.searchPage({
          categoryKey: node.key,
          offset: page * pageSize,
          limit: pageSize,
        });
      } catch (err) {
        errors.push(`category ${node.key} offset ${page * pageSize}: ${String(err)}`);
        if (fatal(err)) {
          stop(err instanceof AldiBlockedError ? 'blocked' : 'request budget');
          break outer;
        }
        stop(`error in ${node.name}`);
        break;
      }
      stat.totalCount = result.totalCount;
      for (const p of result.products) {
        stat.fetched++;
        if (!bySku.has(p.sku)) {
          bySku.set(p.sku, p);
          stat.newUnique++;
        }
        if (bySku.size >= maxProducts) {
          stop('product cap');
          break outer;
        }
        if (options.maxPerCategory && stat.fetched >= options.maxPerCategory) break;
      }
      if (options.maxPerCategory && stat.fetched >= options.maxPerCategory) {
        if (stat.fetched < result.totalCount) stop('per-category cap');
        break;
      }
      if (result.products.length === 0 || (page + 1) * pageSize >= result.totalCount) break;
    }
    log({ level: 'info', msg: 'category done', ...stat });
  }

  return {
    products: [...bySku.values()],
    complete,
    expectedTotal,
    categories,
    errors,
    stoppedReason,
  };
}
