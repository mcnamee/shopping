/**
 * Test harness for the Stage 2 API: the real router, handler, stores and repos over the
 * in-memory DynamoDB fake, a small catalogue, and a controllable clock.
 */
import type { Context } from 'aws-lambda';
import {
  buildSearchIndex,
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_THUMB_MAX_BYTES,
  recipePhotoKey,
  recipeThumbKey,
  type CatalogueProduct,
  type UnitType,
} from '@trolley/core';
import { Db } from '../db';
import { createHandler } from '../handler';
import type { SearchableCatalogueProduct } from '../products/catalogue-cache';
import { CustomProductRepo } from '../products/custom-products';
import type { ProductDeps } from '../products/routes';
import { createRouter, type ApiEvent } from '../router';
import {
  createRoutes,
  stage2DepsFor,
  stage3DepsFor,
  stage4DepsFor,
  stage5DepsFor,
} from '../routes';
import type { PhotoStore } from '../recipes/photos';
import type { AiTextModel } from '../suggestions/bedrock';
import { fakeDynamo } from './fake-dynamo';

export const T0 = Date.parse('2026-11-22T03:00:00.000Z'); // Sun 22 Nov, 2 pm in Canberra

export function product(
  sku: string,
  name: string,
  groupId: string,
  unitType: UnitType = 'pack',
  extra: Partial<CatalogueProduct> = {},
): CatalogueProduct {
  return {
    sku,
    name,
    brand: 'Farmdale',
    packSize: unitType === 'kg' ? 'per kg' : '1 each',
    unitType,
    price: 100,
    unitPrice: null,
    imageUrl: `https://img.example/${sku}.jpg`,
    groupId,
    categories: [],
    storeId: 'G526',
    firstSeenAt: '',
    lastSeenAt: '',
    missedRuns: 0,
    discontinued: false,
    ...extra,
  };
}

export const MILK = '398691';
export const BANANAS = '100001';
export const BREAD = '500001';
export const MINCE = '600001';
export const ICE_CREAM = '700001';

export const CATALOGUE: CatalogueProduct[] = [
  product(MILK, 'Full Cream Milk 2L', 'dairy-eggs', 'pack', { packSize: '2 L' }),
  product(BANANAS, 'Cavendish Bananas', 'fruit-veg', 'kg'),
  product(BREAD, 'Wholemeal Bread', 'bakery', 'each'),
  product(MINCE, 'Beef Mince 500g', 'meat-seafood', 'pack'),
  product(ICE_CREAM, 'Vanilla Ice Cream 2L', 'frozen', 'pack', { discontinued: true }),
  // Bulk products for limit tests.
  ...Array.from({ length: 260 }, (_, i) =>
    product(String(800000 + i), `Bulk item ${String(i).padStart(3, '0')}`, 'pantry', 'each'),
  ),
];

const context = { awsRequestId: 'r' } as Context;

export interface CallOptions {
  path?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Household id in the token; default home-1. Null sends no token. */
  hh?: string | null;
  user?: string;
  /** Extra ID-token claims (e.g. name). */
  claims?: Record<string, string>;
  /** Request headers (lower-case names, as API Gateway sends them). */
  headers?: Record<string, string>;
  /** Raw body string (sent as is instead of JSON.stringify(body)). */
  rawBody?: string;
  /** Raw query string (API Gateway rawQueryString). */
  rawQuery?: string;
  /** Viewer address (requestContext.http.sourceIp). */
  sourceIp?: string;
}

export interface CallResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Record<string, string>;
  /** Unparsed body (HTML pages, empty bodies). */
  raw: string;
}

export const ORIGIN = 'https://trolley.example.com';

export interface SetupOptions {
  /** Suggestions AI model (default none: rules only). */
  ai?: AiTextModel | null;
  aiTimeoutMs?: number;
  /** Extra catalogue products (Stage 4 resolution tests). */
  extraProducts?: CatalogueProduct[];
}

export function setup(opts: SetupOptions = {}) {
  const table = fakeDynamo();
  const db = new Db(table.doc, 'T');
  let clock = T0;
  const now = () => new Date(clock);
  const custom = new CustomProductRepo(table.doc, 'T', 0);
  const products = [...CATALOGUE, ...(opts.extraProducts ?? [])];
  const productDeps: ProductDeps = {
    catalogue: {
      get: async () => ({
        index: buildSearchIndex(products as SearchableCatalogueProduct[]),
        bySku: new Map(products.map((p) => [p.sku, p])),
        loadedAt: 0,
      }),
    },
    custom,
  };
  const stage2 = stage2DepsFor(db, productDeps, now);
  productDeps.settings = stage2.settings;
  const warnings: Array<Record<string, unknown>> = [];
  const stage3 = {
    ...stage3DepsFor(db, stage2, opts.ai ?? null, opts.aiTimeoutMs),
    warn: (e: Record<string, unknown>) => warnings.push(e),
  };
  const logs: Array<Record<string, unknown>> = [];
  const stage4 = stage4DepsFor(db, stage3, productDeps, ORIGIN);
  stage4.oauth.log = (e) => logs.push(e);
  stage4.mcp.log = (e) => logs.push(e);
  stage4.shortcuts.log = (e) => logs.push(e);
  let photoSeq = 0;
  const deletedPhotos: string[] = [];
  const photos: PhotoStore = {
    presign: async (householdId) => {
      photoSeq += 1;
      const id = `00000000-0000-4000-8000-${String(photoSeq).padStart(12, '0')}`;
      const photoKey = recipePhotoKey(householdId, id);
      const post = (key: string, maxBytes: number) => ({
        url: 'https://media.example.s3.amazonaws.com/',
        fields: { key: `media/${key}`, 'Content-Type': 'image/jpeg' },
        key: `media/${key}`,
        maxBytes,
      });
      return {
        photoKey,
        full: post(photoKey, RECIPE_PHOTO_MAX_BYTES),
        thumb: post(recipeThumbKey(photoKey), RECIPE_THUMB_MAX_BYTES),
        expiresIn: 300,
      };
    },
    remove: async (key) => {
      deletedPhotos.push(key);
    },
  };
  const stage5 = stage5DepsFor(db, stage2, photos);
  const handler = createHandler(
    createRouter(
      createRoutes(
        productDeps,
        () => stage2,
        () => stage3,
        () => stage4,
        () => stage5,
      ),
    ),
  );

  async function call<T = Record<string, unknown>>(
    routeKey: string,
    opts: CallOptions = {},
  ): Promise<CallResult<T>> {
    const [method = 'GET', path = '/'] = routeKey.split(' ');
    const hh = opts.hh === undefined ? 'home-1' : opts.hh;
    const claims = hh
      ? {
          sub: opts.user ?? 'user-1',
          email: 'a@example.com',
          token_use: 'id',
          'custom:householdId': hh,
          ...opts.claims,
        }
      : null;
    const event = {
      version: '2.0',
      routeKey,
      rawPath: path,
      rawQueryString: opts.rawQuery ?? '',
      headers: opts.headers ?? {},
      isBase64Encoded: false,
      ...(opts.query ? { queryStringParameters: opts.query } : {}),
      ...(opts.path ? { pathParameters: opts.path } : {}),
      ...(opts.rawBody !== undefined
        ? { body: opts.rawBody }
        : opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
      requestContext: {
        accountId: '1',
        apiId: 'api',
        domainName: 'x',
        domainPrefix: 'x',
        http: {
          method,
          path,
          protocol: 'HTTP/1.1',
          sourceIp: opts.sourceIp ?? '127.0.0.1',
          userAgent: 't',
        },
        requestId: 'r',
        routeKey,
        stage: '$default',
        time: '',
        timeEpoch: 0,
        ...(claims ? { authorizer: { jwt: { claims, scopes: null } } } : {}),
      },
    } as ApiEvent;
    const res = await handler(event, context);
    const raw = res.body ?? '';
    let body: unknown = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    return {
      status: res.statusCode as number,
      body: body as T,
      headers: (res.headers ?? {}) as Record<string, string>,
      raw,
    };
  }

  return {
    table,
    db,
    stage2,
    stage3,
    stage4,
    stage5,
    deletedPhotos,
    logs,
    warnings,
    call,
    custom,
    advance: (ms: number) => {
      clock += ms;
    },
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

export type Harness = ReturnType<typeof setup>;
