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

export interface ScrapeRunRecord {
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'partial' | 'failed';
  trigger: string;
  servicePoint: string | null;
  durationMs: number;
  requests: number;
  expectedTotal: number | null;
  fetched: number;
  previousActive: number;
  created: number;
  updated: number;
  reactivated: number;
  missed: number;
  discontinued: number;
  discontinueStep: 'applied' | 'skipped';
  unmappedCategories: Record<string, number>;
  unitTypes: Record<string, number>;
  errors: string[];
  message?: string;
}

export interface CatalogueStore {
  loadProducts(): Promise<CatalogueProduct[]>;
  writeProducts(products: readonly CatalogueProduct[], updatedAt: string): Promise<void>;
  putRun(run: ScrapeRunRecord): Promise<void>;
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

  async putRun(run: ScrapeRunRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: { pk: keys.scrapeRunPk, sk: run.startedAt, entity: 'ScrapeRun', ...run },
      }),
    );
  }
}
