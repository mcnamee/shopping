/**
 * In-memory catalogue for search (D-034): the whole catalogue (~3.3k products, ~2 MB
 * as DynamoDB items) is loaded with one paginated GSI1 Query and kept per Lambda
 * container for `ttlMs` (default 10 min). Concurrent requests share one load; if a
 * refresh fails but an older copy exists, the stale copy keeps serving.
 */
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  buildSearchIndex,
  itemToCatalogueProduct,
  keys,
  type CatalogueProduct,
  type SearchIndex,
} from '@trolley/core';
import type { DocSender } from './doc';

export type SearchableCatalogueProduct = CatalogueProduct & { custom?: false };

export interface CatalogueSnapshot {
  index: SearchIndex<SearchableCatalogueProduct>;
  bySku: ReadonlyMap<string, CatalogueProduct>;
  loadedAt: number;
}

export const CATALOGUE_TTL_MS = 10 * 60 * 1000;

/** Only the attributes search and detail need (smaller responses over the wire). */
const PROJECTION = [
  'entity',
  'sku',
  '#name',
  'brand',
  'packSize',
  'unitType',
  'price',
  'unitPrice',
  'imageUrl',
  'groupId',
  'categories',
  'discontinued',
].join(', ');

export function dynamoCatalogueLoader(doc: DocSender, tableName: string) {
  return async function load(): Promise<CatalogueProduct[]> {
    const products: CatalogueProduct[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = (await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': keys.catalogueGsi1Pk },
          ExpressionAttributeNames: { '#name': 'name' },
          ProjectionExpression: PROJECTION,
          ExclusiveStartKey: startKey,
        }),
      )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      for (const item of res.Items ?? []) {
        const p = itemToCatalogueProduct(item);
        if (p) products.push(p);
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return products;
  };
}

export class CatalogueCache {
  private snapshot: CatalogueSnapshot | null = null;
  private inflight: Promise<CatalogueSnapshot> | null = null;

  constructor(
    private readonly load: () => Promise<CatalogueProduct[]>,
    private readonly ttlMs = CATALOGUE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<CatalogueSnapshot> {
    if (this.snapshot && this.now() - this.snapshot.loadedAt < this.ttlMs) return this.snapshot;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<CatalogueSnapshot> {
    try {
      const products = await this.load();
      this.snapshot = {
        index: buildSearchIndex(products as SearchableCatalogueProduct[]),
        bySku: new Map(products.map((p) => [p.sku, p])),
        loadedAt: this.now(),
      };
      return this.snapshot;
    } catch (err) {
      if (this.snapshot) {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'catalogue refresh failed; serving stale',
            error: String(err),
          }),
        );
        return this.snapshot;
      }
      throw err;
    }
  }
}
