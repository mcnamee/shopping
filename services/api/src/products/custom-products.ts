/**
 * Household custom products (HH#<hh> / PRODUCT#custom-<uuid>). Cached per household for
 * a short TTL so type-ahead does not query on every keystroke; a create updates the
 * local cache immediately (the other phone sees it within `ttlMs`).
 */
import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CUSTOM_SKU_PREFIX,
  customProductToItem,
  itemToCustomProduct,
  keys,
  type CustomProduct,
} from '@trolley/core';
import type { DocSender } from './doc';

export const CUSTOM_TTL_MS = 60 * 1000;
export const MAX_CUSTOM_PRODUCTS = 500;

export class CustomProductRepo {
  private readonly cache = new Map<string, { products: CustomProduct[]; loadedAt: number }>();

  constructor(
    private readonly doc: DocSender,
    private readonly tableName: string,
    private readonly ttlMs = CUSTOM_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async list(householdId: string): Promise<CustomProduct[]> {
    const hit = this.cache.get(householdId);
    if (hit && this.now() - hit.loadedAt < this.ttlMs) return hit.products;
    const products: CustomProduct[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': keys.householdPk(householdId),
            ':sk': keys.customProductSk(CUSTOM_SKU_PREFIX),
          },
          ExclusiveStartKey: startKey,
        }),
      )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      for (const item of res.Items ?? []) {
        const p = itemToCustomProduct(item);
        if (p) products.push(p);
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    this.cache.set(householdId, { products, loadedAt: this.now() });
    return products;
  }

  async get(householdId: string, sku: string): Promise<CustomProduct | null> {
    const res = (await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: keys.householdPk(householdId), sk: keys.customProductSk(sku) },
      }),
    )) as { Item?: Record<string, unknown> };
    return res.Item ? itemToCustomProduct(res.Item) : null;
  }

  async create(
    householdId: string,
    input: Omit<CustomProduct, 'sku' | 'createdAt'>,
  ): Promise<CustomProduct> {
    const product: CustomProduct = {
      sku: `${CUSTOM_SKU_PREFIX}${randomUUID()}`,
      name: input.name,
      brand: input.brand,
      packSize: input.packSize,
      unitType: input.unitType,
      groupId: input.groupId,
      createdAt: new Date(this.now()).toISOString(),
      createdBy: input.createdBy,
    };
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: customProductToItem(householdId, product),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    const hit = this.cache.get(householdId);
    if (hit) hit.products = [...hit.products, product];
    return product;
  }
}
