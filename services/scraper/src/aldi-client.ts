/**
 * ALDI AU adapter: the only module that knows ALDI URLs, params and error shapes.
 * Polite by construction: one request at a time, at least `minIntervalMs` between
 * request starts, bounded retries with exponential backoff (honouring Retry-After),
 * a hard request budget, and an honest non-browser User-Agent.
 *
 * Note: Akamai in front of api.aldi.com.au returned 403 "Access Denied" (HTML) for a
 * Chrome-like User-Agent from a non-browser client, but 200 for a plain client UA.
 * We never impersonate a browser.
 */
import type { AldiCategoryNode, AldiProduct, AldiSearchResponse } from './aldi-types';

export const ALDI_API_BASE = 'https://api.aldi.com.au';
/** ALDI Casey, 15 Kingsland Parade, Casey ACT 2913 (D-030). */
export const DEFAULT_SERVICE_POINT = 'G526';
export const ALLOWED_PAGE_SIZES = [12, 16, 24, 30, 32, 48, 60] as const;
export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];
/** Smallest allowed page size that fits `maxPerCategory` (60 when uncapped). */
export function pageSizeFor(maxPerCategory: number | undefined): PageSize {
  if (!maxPerCategory) return 60;
  return ALLOWED_PAGE_SIZES.find((s) => s >= maxPerCategory) ?? 60;
}

export const DEFAULT_USER_AGENT = 'TrolleyCatalogue/1.0 (personal household shopping list)';

export class AldiHttpError extends Error {
  override name = 'AldiHttpError';
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly detail: string,
  ) {
    super(`ALDI API ${status} for ${url}: ${detail}`);
  }
}

/** Bot protection (Akamai 403 / HTML). Not retried further: retrying makes it worse. */
export class AldiBlockedError extends AldiHttpError {
  override name = 'AldiBlockedError';
}

export class AldiShapeError extends Error {
  override name = 'AldiShapeError';
}

export class RequestBudgetExceededError extends Error {
  override name = 'RequestBudgetExceededError';
}

export interface AldiClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  servicePoint?: string | null;
  userAgent?: string;
  /** Minimum gap between request starts (default 1000 ms). */
  minIntervalMs?: number;
  /** Retries after the first attempt for 429/5xx/timeouts/network errors (default 2 = max 3 attempts). */
  maxRetries?: number;
  /** First backoff delay; doubles each retry, plus up to 50% jitter (default 2000 ms). */
  backoffBaseMs?: number;
  /** Per-request timeout (default 20 s). */
  timeoutMs?: number;
  /** Hard cap on HTTP requests made by this client, retries included (default 500). */
  maxRequests?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  log?: (event: Record<string, unknown>) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 200);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCategoryNode(v: unknown): v is AldiCategoryNode {
  return (
    isObject(v) &&
    typeof v.key === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.children) &&
    v.children.every(isCategoryNode)
  );
}

function isProduct(v: unknown): v is AldiProduct {
  return isObject(v) && typeof v.sku === 'string' && typeof v.name === 'string';
}

export class AldiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly servicePoint: string | null;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxRequests: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (event: Record<string, unknown>) => void;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  /** HTTP requests made so far (retries included). */
  requestCount = 0;

  constructor(options: AldiClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? ALDI_API_BASE;
    this.servicePoint =
      options.servicePoint === undefined ? DEFAULT_SERVICE_POINT : options.servicePoint;
    if (this.servicePoint !== null && !/^[A-Z0-9-]{2,12}$/.test(this.servicePoint)) {
      throw new Error(`Invalid ALDI service point: ${this.servicePoint}`);
    }
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffBaseMs = options.backoffBaseMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRequests = options.maxRequests ?? 500;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? (() => undefined);
  }

  /** Full category tree. */
  async getCategoryTree(): Promise<AldiCategoryNode[]> {
    const body = await this.getJson('/v2/product-category-tree', { currency: 'AUD' });
    if (!isObject(body) || !Array.isArray(body.data) || !body.data.every(isCategoryNode)) {
      throw new AldiShapeError('Unexpected category tree response shape');
    }
    return body.data;
  }

  /** One page of products, optionally filtered by category and/or query text. */
  async searchPage(params: {
    categoryKey?: string;
    q?: string;
    offset: number;
    limit: PageSize;
  }): Promise<{ products: AldiProduct[]; totalCount: number }> {
    if (!ALLOWED_PAGE_SIZES.includes(params.limit)) {
      throw new Error(`ALDI page size must be one of ${ALLOWED_PAGE_SIZES.join(',')}`);
    }
    const query: Record<string, string> = {
      currency: 'AUD',
      serviceType: 'walk-in',
      limit: String(params.limit),
      offset: String(params.offset),
    };
    if (this.servicePoint) query.servicePoint = this.servicePoint;
    if (params.categoryKey) query.categoryKey = params.categoryKey;
    if (params.q) query.q = params.q;

    const body = await this.getJson('/v3/product-search', query);
    if (!isObject(body) || !Array.isArray(body.data) || !isObject(body.meta)) {
      throw new AldiShapeError('Unexpected product search response shape');
    }
    const pagination = (body as unknown as AldiSearchResponse).meta.pagination;
    if (!isObject(pagination) || typeof pagination.totalCount !== 'number') {
      throw new AldiShapeError('Product search response has no pagination.totalCount');
    }
    // Skip (but count) malformed entries rather than failing the whole page.
    const products = body.data.filter(isProduct);
    if (products.length !== body.data.length) {
      this.log({
        level: 'warn',
        msg: 'skipped malformed products',
        count: body.data.length - products.length,
      });
    }
    return { products, totalCount: pagination.totalCount };
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter !== null ? Number(retryAfter) : NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const base = this.backoffBaseMs * 2 ** attempt;
    return Math.round(base + base * 0.5 * this.random());
  }

  private async getJson(path: string, query: Record<string, string>): Promise<unknown> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(query).toString()}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.requestCount >= this.maxRequests) {
        throw new RequestBudgetExceededError(`Request budget of ${this.maxRequests} exhausted`);
      }
      await this.throttle();
      this.requestCount++;

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { accept: 'application/json', 'user-agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = err;
        this.log({ level: 'warn', msg: 'network error', url, attempt, error: String(err) });
        if (attempt < this.maxRetries) await this.sleep(this.backoff(attempt, null));
        continue;
      }

      const text = await res.text();
      const contentType = res.headers.get('content-type') ?? '';

      if (res.ok) {
        if (!contentType.includes('json')) {
          // A 200 HTML page is a challenge/interstitial, not data.
          throw new AldiBlockedError(res.status, url, `non-JSON response: ${snippet(text)}`);
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new AldiShapeError(`Invalid JSON from ${url}`);
        }
      }

      if (res.status === 403) {
        throw new AldiBlockedError(res.status, url, snippet(text));
      }
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new AldiHttpError(res.status, url, snippet(text));
      if (!retryable) throw lastError;
      this.log({ level: 'warn', msg: 'retryable status', url, status: res.status, attempt });
      if (attempt < this.maxRetries) {
        await this.sleep(this.backoff(attempt, res.headers.get('retry-after')));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
