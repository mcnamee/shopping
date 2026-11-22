import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { HealthResponse, MeResponse } from '@trolley/core';
import { json } from './http';
import { CatalogueCache, dynamoCatalogueLoader } from './products/catalogue-cache';
import { CustomProductRepo } from './products/custom-products';
import type { DocSender } from './products/doc';
import { createProductRoutes, type ProductDeps } from './products/routes';
import type { RouteTable } from './router';

export const baseRoutes: RouteTable = {
  'GET /api/health': {
    auth: false,
    handler: () => json(200, { status: 'ok' } satisfies HealthResponse),
  },
  'GET /api/me': {
    auth: true,
    handler: ({ household }) =>
      json(200, {
        userId: household.userId,
        email: household.email,
        householdId: household.householdId,
      } satisfies MeResponse),
  },
};

/** Production dependencies, created lazily so tests and /api/health need no AWS config. */
function lazyProductDeps(): ProductDeps {
  let deps: { catalogue: CatalogueCache; custom: CustomProductRepo } | undefined;
  const get = () => {
    if (!deps) {
      const tableName = process.env.TABLE_NAME;
      if (!tableName) throw new Error('TABLE_NAME is not set');
      const doc: DocSender = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
      deps = {
        catalogue: new CatalogueCache(dynamoCatalogueLoader(doc, tableName)),
        custom: new CustomProductRepo(doc, tableName),
      };
    }
    return deps;
  };
  return {
    catalogue: { get: () => get().catalogue.get() },
    custom: {
      list: (hh) => get().custom.list(hh),
      get: (hh, sku) => get().custom.get(hh, sku),
      create: (hh, input) => get().custom.create(hh, input),
    },
  };
}

export function createRoutes(productDeps: ProductDeps = lazyProductDeps()): RouteTable {
  return { ...baseRoutes, ...createProductRoutes(productDeps) };
}

export const routes: RouteTable = createRoutes();
