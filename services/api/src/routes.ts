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
import { createRecipeMatchRoutes, MATCH_AI_TIMEOUT_MS, type MatchDeps } from './recipes/match';
import { createPlanRoutes } from './plan/routes';
import { PlanRuleStore } from './plan/rules-store';
import { PlanStore } from './plan/store';
import { createRecipeRoutes, type Stage5Deps } from './recipes/routes';
import { RecipeStore } from './recipes/store';
import { s3PhotoStore } from './recipes/photos';
import { createStage2Routes, type Stage2Deps } from './stage2';
import { bedrockModel, type AiTextModel } from './suggestions/bedrock';
import { AI_TIMEOUT_MS, createSuggestionRoutes, type Stage3Deps } from './suggestions/routes';
import { SuggestionStore } from './suggestions/store';
import { TemplateStore } from './templates/store';
import { createMcpRoutes, type McpDeps } from './mcp/server';
import { createTools } from './mcp/tools';
import { createOAuthRoutes, originFromEnv, type OAuthDeps } from './oauth/routes';
import { OAuthStore } from './oauth/store';
import { createShortcutRoutes, type ShortcutDeps } from './shortcuts/routes';
import { ShortcutKeyStore } from './shortcuts/store';

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

/**
 * The suggestions model from SUGGEST_MODEL_ID (CDK context `suggestModelId`, D-061); unset
 * or "none" means rules only.
 */
export function aiModelFromEnv(env: NodeJS.ProcessEnv = process.env): AiTextModel | null {
  const id = env.SUGGEST_MODEL_ID?.trim();
  return id && id !== 'none' ? bedrockModel(id) : null;
}

/** Stage 3 dependencies, sharing the Stage 2 stores. */
export function stage3DepsFor(
  db: Db,
  stage2: Stage2Deps,
  ai: AiTextModel | null,
  aiTimeoutMs = AI_TIMEOUT_MS,
): Stage3Deps {
  return {
    lists: stage2.lists,
    templates: stage2.templates,
    settings: stage2.settings,
    suggestions: new SuggestionStore(db),
    resolveProduct: stage2.resolveProduct,
    ai,
    aiTimeoutMs,
    now: stage2.now,
  };
}

export interface Stage4Deps {
  oauth: OAuthDeps;
  mcp: McpDeps;
  shortcuts: ShortcutDeps;
}

/** Stage 4 dependencies (OAuth shim + MCP tools), sharing the Stage 2/3 stores. */
export function stage4DepsFor(
  db: Db,
  stage3: Stage3Deps,
  productDeps: Pick<ProductDeps, 'catalogue' | 'custom'>,
  origin: string,
): Stage4Deps {
  const store = new OAuthStore(db);
  const callTool = createTools(() => ({
    lists: stage3.lists,
    settings: stage3.settings,
    purchases: (hh) => stage3.suggestions.purchases(hh),
    catalogue: () => productDeps.catalogue.get(),
    customs: (hh) => productDeps.custom.list(hh),
    templates: (hh) => stage3.templates.list(hh),
    resolveProduct: stage3.resolveProduct,
    now: stage3.now,
  }));
  return {
    oauth: { store, origin, now: stage3.now },
    mcp: { store, origin, now: stage3.now, callTool },
    shortcuts: {
      keys: new ShortcutKeyStore(db),
      limiter: store,
      lists: stage3.lists,
      callTool,
      now: stage3.now,
    },
  };
}

/** Stage 5 dependencies (recipes + photos), sharing the Stage 2 list store. */
export function stage5DepsFor(
  db: Db,
  stage2: Stage2Deps,
  photos: Stage5Deps['photos'],
): Stage5Deps {
  return {
    recipes: new RecipeStore(db, stage2.now),
    plan: new PlanStore(db, stage2.now),
    planRules: new PlanRuleStore(db, stage2.now),
    photos,
    lists: stage2.lists,
    now: stage2.now,
  };
}

/** Recipe ingredient matching (D-115): shares the suggestions model, stores and catalogue. */
export function recipeMatchDepsFor(
  stage3: Stage3Deps,
  stage5: Stage5Deps,
  productDeps: Pick<ProductDeps, 'catalogue' | 'custom'>,
): MatchDeps {
  return {
    recipes: stage5.recipes,
    settings: stage3.settings,
    suggestions: stage3.suggestions,
    templates: (hh) => stage3.templates.list(hh),
    catalogue: () => productDeps.catalogue.get(),
    customs: (hh) => productDeps.custom.list(hh),
    resolveProduct: stage3.resolveProduct,
    ai: stage3.ai,
    aiTimeoutMs: Math.min(stage3.aiTimeoutMs, MATCH_AI_TIMEOUT_MS),
    now: stage3.now,
    ...(stage3.warn ? { warn: stage3.warn } : {}),
  };
}

export function createRoutes(
  productDeps?: ProductDeps,
  stage2?: () => Stage2Deps,
  stage3?: () => Stage3Deps,
  stage4?: () => Stage4Deps,
  stage5?: () => Stage5Deps,
): RouteTable {
  const prod = lazyProd();
  const products = productDeps ?? productDepsFrom(prod);
  let s2: Stage2Deps | undefined;
  const getStage2 =
    stage2 ?? (() => (s2 ??= { ...stage2DepsFor(prod().db, products), settings: prod().settings }));
  let s3: Stage3Deps | undefined;
  const getStage3 =
    stage3 ?? (() => (s3 ??= stage3DepsFor(prod().db, getStage2(), aiModelFromEnv())));
  let s4: Stage4Deps | undefined;
  const getStage4 =
    stage4 ?? (() => (s4 ??= stage4DepsFor(prod().db, getStage3(), products, originFromEnv())));
  let s5: Stage5Deps | undefined;
  const getStage5 =
    stage5 ??
    (() =>
      (s5 ??= stage5DepsFor(prod().db, getStage2(), s3PhotoStore(requiredEnv('MEDIA_BUCKET')))));
  return {
    ...baseRoutes,
    ...createRecipeRoutes(getStage5),
    ...createPlanRoutes(() => {
      const s5d = getStage5();
      return { plan: s5d.plan, rules: s5d.planRules, recipes: s5d.recipes };
    }),
    ...createRecipeMatchRoutes(() => recipeMatchDepsFor(getStage3(), getStage5(), products)),
    ...createProductRoutes(products),
    ...createStage2Routes(getStage2),
    ...createSuggestionRoutes(getStage3),
    ...createOAuthRoutes(() => getStage4().oauth),
    ...createMcpRoutes(() => getStage4().mcp),
    ...createShortcutRoutes(() => getStage4().shortcuts),
  };
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const routes: RouteTable = createRoutes();
