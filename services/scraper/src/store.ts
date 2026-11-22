/**
 * Catalogue persistence. `CatalogueStore` is the seam the run logic depends on; the
 * DynamoDB implementation only ever touches PRODUCT#* and SCRAPE#* partitions (IAM
 * enforces the same with dynamodb:LeadingKeys, see infra).
 */
import { BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  catalogueProductToItem,
  itemToCatalogueProduct,
  keys,
  type CatalogueProduct,
} from '@trolley/core';

/** SCRAPE#RUN / <startedAt> (Stage 1 A7). */
export interface ScrapeRunRecord {
  startedAt: string;
  finishedAt: string;
  status: 'succeeded' | 'failed' | 'aborted';
  trigger: string;
  /** ALDI service point (store), e.g. "G526"; null = none. */
  store: string | null;
  durationMs: number;
  requests: number;
  /** Unfiltered catalogue size ALDI reported (coverage check). */
  expectedTotal: number | null;
  /** Count the 50% abort check compared against (previous successful run). */
  baseline: number | null;
  fetched: number;
  new: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  missed: number;
  discontinued: number;
  /** Number of errors (details in errorMessages, max 20). */
  errors: number;
  discontinueStep: 'applied' | 'skipped';
  unmappedCategories: Record<string, number>;
  unitTypes: Record<string, number>;
  errorMessages: string[];
  message?: string;
}

export interface CatalogueStore {
  loadProducts(): Promise<CatalogueProduct[]>;
  writeProducts(products: readonly CatalogueProduct[], updatedAt: string): Promise<void>;
  putRun(run: ScrapeRunRecord): Promise<void>;
  /** Most recent run with status "succeeded", or null. */
  lastSuccessfulRun(): Promise<ScrapeRunRecord | null>;
}

/** The one DocumentClient method we use (lets tests pass a plain fake). */
export interface DocSender {
  send(command: QueryCommand | BatchWriteCommand | PutCommand): Promise<Record<string, unknown>>;
}

export interface DynamoStoreOptions {
  tableName: string;
  maxBatchAttempts?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type WriteRequests = NonNullable<
  ConstructorParameters<typeof BatchWriteCommand>[0]['RequestItems']
>[string];

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DynamoCatalogueStore implements CatalogueStore {
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly doc: DocSender,
    private readonly options: DynamoStoreOptions,
  ) {
    this.maxAttempts = options.maxBatchAttempts ?? 8;
    this.backoffBaseMs = options.backoffBaseMs ?? 100;
    this.sleep = options.sleep ?? realSleep;
  }

  async loadProducts(): Promise<CatalogueProduct[]> {
    const products: CatalogueProduct[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.options.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': keys.catalogueGsi1Pk },
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
  }

  /** BatchWrite in chunks of 25, retrying UnprocessedItems with exponential backoff. */
  async writeProducts(products: readonly CatalogueProduct[], updatedAt: string): Promise<void> {
    const table = this.options.tableName;
    for (let i = 0; i < products.length; i += 25) {
      let requests: WriteRequests = products
        .slice(i, i + 25)
        .map((p) => ({ PutRequest: { Item: catalogueProductToItem(p, updatedAt) } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `BatchWrite left ${requests.length} unprocessed items after ${this.maxAttempts} attempts`,
          );
        }
        if (attempt > 0) await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
        const res = (await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [table]: requests } }),
        )) as {
          UnprocessedItems?: Record<string, WriteRequests>;
        };
        requests = res.UnprocessedItems?.[table] ?? [];
      }
    }
  }

  async lastSuccessfulRun(): Promise<ScrapeRunRecord | null> {
    let startKey: Record<string, unknown> | undefined;
    // Newest first; failed/aborted runs are skipped by the filter. Bounded scan.
    for (let page = 0; page < 20; page++) {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.options.tableName,
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: '#status = :ok',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': keys.scrapeRunPk, ':ok': 'succeeded' },
          ScanIndexForward: false,
          Limit: 25,
          ExclusiveStartKey: startKey,
        }),
      )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      const item = res.Items?.[0];
      if (item) return item as unknown as ScrapeRunRecord;
      startKey = res.LastEvaluatedKey;
      if (!startKey) return null;
    }
    return null;
  }

  async putRun(run: ScrapeRunRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: { pk: keys.scrapeRunPk, sk: run.startedAt, entity: 'ScrapeRun', ...run },
      }),
    );
  }
}
