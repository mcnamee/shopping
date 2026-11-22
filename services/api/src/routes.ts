import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { HealthResponse, MeResponse } from '@trolley/core';
import { json } from './http';
import { Db } from './db';
import { ListStore } from './lists/store';
import { CatalogueCache, dynamoCatalogueLoader } from './products/catalogue-cache';
import { CustomProductRepo } from './products/custom-products';
import type { DocSender } from './products/doc';
import { productResolver } from './products/resolver';
import { createProductRoutes, type ProductDeps } from './products/routes';
import type { RouteTable } from './router';
import { SettingsStore } from './settings/store';
import { createStage2Routes, type Stage2Deps } from './stage2';
import { TemplateStore } from './templates/store';

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

interface ProdDeps {
  catalogue: CatalogueCache;
  custom: CustomProductRepo;
  db: Db;
  settings: SettingsStore;
}

/** Production dependencies, created lazily so tests and /api/health need no AWS config. */
function lazyProd(): () => ProdDeps {
  let deps: ProdDeps | undefined;
  return () => {
    if (!deps) {
      const tableName = process.env.TABLE_NAME;
      if (!tableName) throw new Error('TABLE_NAME is not set');
      const doc: DocSender = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
      const db = new Db(doc, tableName);
      deps = {
        catalogue: new CatalogueCache(dynamoCatalogueLoader(doc, tableName)),
        custom: new CustomProductRepo(doc, tableName),
        db,
        settings: new SettingsStore(db),
      };
    }
    return deps;
  };
}

function productDepsFrom(get: () => ProdDeps): ProductDeps {
  return {
    catalogue: { get: () => get().catalogue.get() },
    custom: {
      list: (hh) => get().custom.list(hh),
      get: (hh, sku) => get().custom.get(hh, sku),
      create: (hh, input) => get().custom.create(hh, input),
    },
    settings: {
      unitOverrideMap: (hh) => get().settings.unitOverrideMap(hh),
      aisleOrder: (hh) => get().settings.aisleOrder(hh),
    },
  };
}

/** Stage 2 dependencies over one table (production, or a fake DocSender in tests). */
export function stage2DepsFor(
  db: Db,
  productDeps: Pick<ProductDeps, 'catalogue' | 'custom'>,
  now: () => Date = () => new Date(),
): Stage2Deps {
  return {
    lists: new ListStore(db, now),
    templates: new TemplateStore(db, now),
    settings: new SettingsStore(db),
    resolveProduct: productResolver(productDeps),
    now,
  };
}

export function createRoutes(productDeps?: ProductDeps, stage2?: () => Stage2Deps): RouteTable {
  const prod = lazyProd();
  const products = productDeps ?? productDepsFrom(prod);
  let s2: Stage2Deps | undefined;
  const getStage2 =
    stage2 ?? (() => (s2 ??= { ...stage2DepsFor(prod().db, products), settings: prod().settings }));
  return {
    ...baseRoutes,
    ...createProductRoutes(products),
    ...createStage2Routes(getStage2),
  };
}

export const routes: RouteTable = createRoutes();
