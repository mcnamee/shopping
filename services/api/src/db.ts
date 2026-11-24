/**
 * Thin DynamoDB helpers for the single table (spec 5.1). Every read is a GetItem or a
 * Query on a known partition (table or GSI2); there are no scans.
 */
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DocSender } from './products/doc';

export type DbItem = Record<string, unknown>;
export type Key = { pk: string; sk: string };
type Values = Record<string, unknown>;
type Names = Record<string, string>;

export interface Conditional {
  condition?: string;
  names?: Names;
  values?: Values;
}

export type TransactOp =
  | { put: DbItem; condition?: string; names?: Names; values?: Values }
  | { update: Key; expression: string; condition?: string; names?: Names; values?: Values }
  | { delete: Key; condition?: string; names?: Names; values?: Values }
  | { check: Key; condition: string; names?: Names; values?: Values };

/** One condition failed. For a transaction, `failed[i]` is true for each failed op. */
export class ConditionFailed extends Error {
  override name = 'ConditionFailed';
  constructor(public readonly failed: boolean[] = []) {
    super('Condition failed');
  }
}

function isNamed(err: unknown, name: string): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === name;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;

/** GSI2: household lists by status (D-057). */
export const LISTS_INDEX = 'GSI2';

function withExpr(c: { condition?: string; names?: Names; values?: Values }) {
  return {
    ...(c.condition ? { ConditionExpression: c.condition } : {}),
    ...(c.names && Object.keys(c.names).length ? { ExpressionAttributeNames: c.names } : {}),
    ...(c.values && Object.keys(c.values).length ? { ExpressionAttributeValues: c.values } : {}),
  };
}

export class Db {
  constructor(
    readonly doc: DocSender,
    readonly tableName: string,
  ) {}

  async get(key: Key): Promise<DbItem | null> {
    const res = (await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
    )) as { Item?: DbItem };
    return res.Item ?? null;
  }

  /** All items in a partition (optionally with a sort-key prefix), strongly consistent. */
  async queryAll(pk: string, skPrefix?: string): Promise<DbItem[]> {
    const items: DbItem[] = [];
    let startKey: DbItem | undefined;
    do {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      )) as { Items?: DbItem[]; LastEvaluatedKey?: DbItem };
      items.push(...(res.Items ?? []));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  /**
   * Like queryAll but returning only `attrs` (ProjectionExpression), e.g. recipe summaries
   * without their long text (B2). Strongly consistent.
   */
  async queryProjected(pk: string, skPrefix: string, attrs: readonly string[]): Promise<DbItem[]> {
    const names = Object.fromEntries(attrs.map((a, i) => [`#p${i}`, a]));
    const items: DbItem[] = [];
    let startKey: DbItem | undefined;
    do {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          ProjectionExpression: Object.keys(names).join(', '),
          ExpressionAttributeNames: names,
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      )) as { Items?: DbItem[]; LastEvaluatedKey?: DbItem };
      items.push(...(res.Items ?? []));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  /** Count items in a partition with a sort-key prefix (Select COUNT; no data returned). */
  async count(pk: string, skPrefix: string): Promise<number> {
    let total = 0;
    let startKey: DbItem | undefined;
    do {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          Select: 'COUNT',
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      )) as { Count?: number; LastEvaluatedKey?: DbItem };
      total += res.Count ?? 0;
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return total;
  }

  /** One page of a GSI2 partition (eventually consistent, as for any GSI). */
  async queryIndexPage(opts: {
    pk: string;
    limit?: number;
    forward: boolean;
    startKey?: DbItem | undefined;
  }): Promise<{ items: DbItem[]; lastKey: DbItem | undefined }> {
    const res = (await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: LISTS_INDEX,
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: { ':pk': opts.pk },
        ScanIndexForward: opts.forward,
        ...(opts.limit ? { Limit: opts.limit } : {}),
        ExclusiveStartKey: opts.startKey,
      }),
    )) as { Items?: DbItem[]; LastEvaluatedKey?: DbItem };
    return { items: res.Items ?? [], lastKey: res.LastEvaluatedKey };
  }

  async queryIndexAll(pk: string): Promise<DbItem[]> {
    const items: DbItem[] = [];
    let startKey: DbItem | undefined;
    do {
      const page = await this.queryIndexPage({ pk, forward: true, startKey });
      items.push(...page.items);
      startKey = page.lastKey;
    } while (startKey);
    return items;
  }

  async put(item: DbItem, c: Conditional = {}): Promise<void> {
    await this.single(new PutCommand({ TableName: this.tableName, Item: item, ...withExpr(c) }));
  }

  /** UpdateItem returning the new item. */
  async update(key: Key, expression: string, c: Conditional = {}): Promise<DbItem> {
    const res = (await this.single(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: expression,
        ReturnValues: 'ALL_NEW',
        ...withExpr(c),
      }),
    )) as { Attributes?: DbItem };
    return res.Attributes ?? {};
  }

  async delete(key: Key, c: Conditional = {}): Promise<void> {
    await this.single(new DeleteCommand({ TableName: this.tableName, Key: key, ...withExpr(c) }));
  }

  private async single(command: PutCommand | UpdateCommand | DeleteCommand) {
    try {
      return await this.doc.send(command);
    } catch (err) {
      if (isNamed(err, 'ConditionalCheckFailedException')) throw new ConditionFailed([true]);
      throw err;
    }
  }

  /**
   * TransactWriteItems (<= 100 ops). Throws ConditionFailed with per-op flags when a
   * condition fails. Transaction conflicts (another transaction on the same item at the
   * same moment, e.g. two phones ticking on one list) are retried with jitter.
   */
  async transact(ops: TransactOp[]): Promise<void> {
    const items = ops.map((op) => {
      if ('put' in op) return { Put: { TableName: this.tableName, Item: op.put, ...withExpr(op) } };
      if ('update' in op) {
        return {
          Update: {
            TableName: this.tableName,
            Key: op.update,
            UpdateExpression: op.expression,
            ...withExpr(op),
          },
        };
      }
      if ('delete' in op) {
        return { Delete: { TableName: this.tableName, Key: op.delete, ...withExpr(op) } };
      }
      return {
        ConditionCheck: {
          TableName: this.tableName,
          Key: op.check,
          ...withExpr(op),
          ConditionExpression: op.condition,
        },
      };
    });
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
        return;
      } catch (err) {
        const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> })
          .CancellationReasons;
        if (isNamed(err, 'TransactionCanceledException') && reasons) {
          const failed = reasons.map((r) => r.Code === 'ConditionalCheckFailed');
          if (failed.some(Boolean)) throw new ConditionFailed(failed);
          const conflict = reasons.some((r) => r.Code === 'TransactionConflict');
          if (conflict && attempt < 4) {
            await sleep(20 * attempt + Math.random() * 30);
            continue;
          }
        }
        if (isNamed(err, 'TransactionConflictException') && attempt < 4) {
          await sleep(20 * attempt + Math.random() * 30);
          continue;
        }
        throw err;
      }
    }
  }

  /** BatchWriteItem in chunks of 25, retrying unprocessed items with backoff. */
  async batchWrite(requests: Array<{ put: DbItem } | { delete: Key }>): Promise<void> {
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      let pending: unknown[] = requests
        .slice(i, i + BATCH_SIZE)
        .map((r) =>
          'put' in r ? { PutRequest: { Item: r.put } } : { DeleteRequest: { Key: r.delete } },
        );
      for (let attempt = 1; pending.length > 0; attempt += 1) {
        if (attempt > MAX_ATTEMPTS) throw new Error('BatchWrite: unprocessed items remain');
        if (attempt > 1) await sleep(Math.min(1000, 25 * 2 ** attempt) * Math.random());
        const res = (await this.doc.send(
          new BatchWriteCommand({
            RequestItems: { [this.tableName]: pending as never },
          }),
        )) as { UnprocessedItems?: Record<string, unknown[]> };
        pending = res.UnprocessedItems?.[this.tableName] ?? [];
      }
    }
  }
}

/** Opaque pagination cursor for a GSI page (base64url JSON of LastEvaluatedKey). */
export function encodeKeyCursor(key: DbItem | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : null;
}

export function decodeKeyCursor(cursor: string): DbItem | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    for (const v of Object.values(value)) if (typeof v !== 'string') return null;
    return value as DbItem;
  } catch {
    return null;
  }
}
