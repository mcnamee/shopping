import { BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { CatalogueProduct } from '@trolley/core';
import { describe, expect, it } from 'vitest';
import { DynamoCatalogueStore, type DocSender } from '../src/store';

type Cmd = QueryCommand | BatchWriteCommand | PutCommand;

/** Fake DocumentClient: records commands, answers from a queue of responses. */
function fakeDoc(responses: Array<Record<string, unknown>> = []) {
  const calls: Cmd[] = [];
  const doc: DocSender = {
    send: async (cmd) => {
      calls.push(cmd);
      return responses.length > 1 ? responses.shift()! : (responses[0] ?? {});
    },
  };
  const of = <C extends Cmd>(type: new (...args: never[]) => C) =>
    calls.filter((c): c is C => c instanceof type).map((c) => c.input as C['input']);
  return { doc, calls, of };
}

const noSleep = async () => undefined;

const product = (sku: string): CatalogueProduct => ({
  sku,
  name: `Product ${sku}`,
  brand: null,
  packSize: '1 L',
  unitType: 'pack',
  price: 100,
  unitPrice: null,
  imageUrl: null,
  groupId: 'dairy-eggs',
  categories: [],
  storeId: 'G526',
  firstSeenAt: '2026-12-01T00:00:00.000Z',
  lastSeenAt: '2026-12-01T00:00:00.000Z',
  missedRuns: 0,
  discontinued: false,
});

describe('DynamoCatalogueStore', () => {
  it('writes in batches of 25 with catalogue keys', async () => {
    const { doc, of } = fakeDoc();
    const store = new DynamoCatalogueStore(doc, { tableName: 'T', sleep: noSleep });
    await store.writeProducts(
      Array.from({ length: 60 }, (_, i) => product(String(i))),
      'now',
    );
    const batches = of(BatchWriteCommand);
    expect(batches.map((b) => b.RequestItems!.T!.length)).toEqual([25, 25, 10]);
    expect(batches[0]!.RequestItems!.T![0]!.PutRequest!.Item).toMatchObject({
      pk: 'PRODUCT#0',
      sk: 'META',
      gsi1pk: 'CATALOGUE#PRODUCT',
      gsi1sk: 'dairy-eggs#0',
      entity: 'Product',
      updatedAt: 'now',
    });
  });

  it('retries unprocessed items with backoff', async () => {
    const sleeps: number[] = [];
    const leftover = [{ PutRequest: { Item: { pk: 'PRODUCT#2' } } }];
    const { doc, of } = fakeDoc([{ UnprocessedItems: { T: leftover } }, {}]);
    const store = new DynamoCatalogueStore(doc, {
      tableName: 'T',
      backoffBaseMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await store.writeProducts([product('1'), product('2')], 'now');
    const batches = of(BatchWriteCommand);
    expect(batches).toHaveLength(2);
    expect(batches[1]!.RequestItems!.T).toEqual(leftover);
    expect(sleeps).toEqual([50]);
  });

  it('throws when items stay unprocessed', async () => {
    const { doc, of } = fakeDoc([
      { UnprocessedItems: { T: [{ PutRequest: { Item: { pk: 'x' } } }] } },
    ]);
    const store = new DynamoCatalogueStore(doc, {
      tableName: 'T',
      maxBatchAttempts: 3,
      sleep: noSleep,
    });
    await expect(store.writeProducts([product('1')], 'now')).rejects.toThrow(/unprocessed/);
    expect(of(BatchWriteCommand)).toHaveLength(3);
  });

  it('loads every page of the catalogue from GSI1 and skips junk', async () => {
    const { doc, of } = fakeDoc([
      {
        Items: [{ ...product('1'), entity: 'Product' }, { entity: 'Other' }],
        LastEvaluatedKey: { pk: 'x' },
      },
      { Items: [{ ...product('2'), entity: 'Product', unitType: 'bogus' }] },
    ]);
    const products = await new DynamoCatalogueStore(doc, { tableName: 'T' }).loadProducts();
    expect(products.map((p) => [p.sku, p.unitType])).toEqual([
      ['1', 'pack'],
      ['2', 'each'],
    ]);
    const queries = of(QueryCommand);
    expect(queries[1]).toMatchObject({ IndexName: 'GSI1', ExclusiveStartKey: { pk: 'x' } });
    expect(queries[0]!.ExpressionAttributeValues).toEqual({ ':pk': 'CATALOGUE#PRODUCT' });
  });

  it('finds the newest succeeded run, paging past filtered-out pages', async () => {
    const { doc, of } = fakeDoc([
      { Items: [], LastEvaluatedKey: { pk: 'SCRAPE#RUN', sk: 'b' } },
      { Items: [{ status: 'succeeded', fetched: 3000 }] },
    ]);
    const run = await new DynamoCatalogueStore(doc, { tableName: 'T' }).lastSuccessfulRun();
    expect(run).toMatchObject({ fetched: 3000 });
    const q = of(QueryCommand);
    expect(q[0]).toMatchObject({
      KeyConditionExpression: 'pk = :pk',
      ScanIndexForward: false,
      ExpressionAttributeValues: { ':pk': 'SCRAPE#RUN', ':ok': 'succeeded' },
    });
    expect(q[1]!.ExclusiveStartKey).toEqual({ pk: 'SCRAPE#RUN', sk: 'b' });
  });

  it('returns null when there is no successful run', async () => {
    const { doc } = fakeDoc([{ Items: [] }]);
    expect(await new DynamoCatalogueStore(doc, { tableName: 'T' }).lastSuccessfulRun()).toBeNull();
  });

  it('puts run records under SCRAPE#RUN', async () => {
    const { doc, of } = fakeDoc();
    await new DynamoCatalogueStore(doc, { tableName: 'T' }).putRun({
      startedAt: '2026-12-01T03:00:00.000Z',
      status: 'success',
    } as never);
    expect(of(PutCommand)[0]!.Item).toMatchObject({
      pk: 'SCRAPE#RUN',
      sk: '2026-12-01T03:00:00.000Z',
      entity: 'ScrapeRun',
    });
  });
});
