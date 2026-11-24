/**
 * POST /api/recipes/{recipeId}/match (D-115, docs/api.md): for each ingredient line of the
 * recipe, the household's ALDI product (templates > history > confident catalogue match,
 * D-099) or null, up to 3 alternatives and a "probably have it" flag. Read-only; counted
 * against a daily per-household limit like suggestions. The household comes only from
 * verified claims, so another household's recipe is a plain 404.
 */
import {
  catalogueSummary,
  customSummary,
  buildSearchIndex,
  ingredientTexts,
  isValidEntityId,
  isNotAtStore,
  localDate,
  matchIngredients,
  mergeRanked,
  parseIngredient,
  searchProducts,
  storeToday,
  type CatalogueProduct,
  type CustomProduct,
  type HistoryPurchase,
  type ProductSummary,
  type RecipeMatchResponse,
  type TemplateLike,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from '../http';
import type { CatalogueSnapshot } from '../products/catalogue-cache';
import type { ProductResolver } from '../products/resolver';
import type { AuthedRequest, RouteTable } from '../router';
import type { SettingsStore } from '../settings/store';
import type { AiTextModel } from '../suggestions/bedrock';
import type { SuggestionStore } from '../suggestions/store';
import { applyChoices, ingredientsHash, TEXT_CHOICE } from './match-cache';
import { buildMatchPrompt, parseMatchReply, type UnsureLine } from './match-ai';
import type { RecipeStore } from './store';

export interface MatchDeps {
  recipes: RecipeStore;
  settings: SettingsStore;
  /** Purchase rows and the daily run counter. */
  suggestions: Pick<SuggestionStore, 'purchases' | 'consumeMatchRun'>;
  templates(householdId: string): Promise<TemplateLike[]>;
  catalogue(): Promise<CatalogueSnapshot>;
  customs(householdId: string): Promise<CustomProduct[]>;
  resolveProduct: ProductResolver;
  /** Null: rule parser only (no model configured). */
  ai: AiTextModel | null;
  aiTimeoutMs: number;
  now: () => Date;
  warn?: (entry: Record<string, unknown>) => void;
}

/** The AI clean-up budget before the rule parser's names are used (D-115). */
export const MATCH_AI_TIMEOUT_MS = 6000;
export const MATCH_RATE_LIMIT_MESSAGE =
  "You've used today's ingredient matching - try again tomorrow.";

const defaultWarn = (entry: Record<string, unknown>) =>
  console.warn(JSON.stringify({ level: 'warn', ...entry }));

class AiTimeout extends Error {
  override name = 'AiTimeout';
}

type Searchable = (CatalogueProduct & { custom?: false }) | (CustomProduct & { custom: true });

export function createRecipeMatchRoutes(getDeps: () => MatchDeps): RouteTable {
  /** The AI pass: ingredient index -> cleaned name. Any failure returns null. */
  async function aiNames(lines: UnsureLine[]): Promise<Map<number, string> | null> {
    const { ai, aiTimeoutMs } = getDeps();
    const warn = getDeps().warn ?? defaultWarn;
    if (!ai || lines.length === 0) return null;
    const prompt = buildMatchPrompt(lines);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      const text = await Promise.race([
        ai(prompt, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AiTimeout());
          }, aiTimeoutMs);
        }),
      ]);
      const parsed = parseMatchReply(text, prompt);
      if (!parsed.ok) {
        warn({ msg: 'recipe_match_ai_fallback', reason: parsed.reason, ms: Date.now() - started });
        return null;
      }
      return parsed.names;
    } catch (err) {
      // Error name only: never recipe text, prompts or model output in logs.
      warn({
        msg: 'recipe_match_ai_fallback',
        reason: err instanceof AiTimeout ? 'timeout' : 'error',
        error: err instanceof Error ? err.name : typeof err,
        ms: Date.now() - started,
      });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function match(req: AuthedRequest): Promise<HttpResult> {
    const hh = req.household.householdId;
    const d = getDeps();
    const id = req.event.pathParameters?.recipeId;
    const recipe = await d.recipes.mustGet(hh, isValidEntityId(id) ? id : fail.notFound());
    const now = d.now();
    const hash = ingredientsHash(recipe.ingredients);
    const refresh = ['1', 'true'].includes(req.event.queryStringParameters?.refresh ?? '');
    // A cache hit does no work and is not counted (D-116).
    if (!refresh) {
      const hit = await d.recipes.matchCache.get(hh, recipe.id, hash, now.getTime());
      if (hit) {
        return json(200, {
          rows: applyChoices(hit.rows, hit.choices),
          ai: hit.ai,
          cached: true,
          cachedAt: hit.cachedAt,
        } satisfies RecipeMatchResponse);
      }
    }
    // Counted before any work, cold start included (like suggestions, D-066).
    if (!(await d.suggestions.consumeMatchRun(hh, localDate(now), now.getTime()))) {
      return fail.rateLimited(MATCH_RATE_LIMIT_MESSAGE);
    }
    const parsed = ingredientTexts(recipe.ingredients).map(parseIngredient);

    const [snapshot, customs, purchases, templates, overrides] = await Promise.all([
      d.catalogue(),
      d.customs(hh),
      d.suggestions.purchases(hh),
      d.templates(hh),
      d.settings.unitOverrideMap(hh),
    ]);
    const today = storeToday(now);

    const unsure: UnsureLine[] = parsed.flatMap((p, index) =>
      p.unsure ? [{ index, line: p.original, guess: p.name }] : [],
    );
    const names = await aiNames(unsure);

    const customIndex = buildSearchIndex<Searchable>(
      customs.map((c) => ({ ...c, custom: true as const })),
    );
    const summaryOf = (item: Searchable): ProductSummary =>
      item.custom ? customSummary(item) : catalogueSummary(item);
    /** A product the household can add: its custom product or a catalogue one on the shelf. */
    const available = async (productId: string): Promise<ProductSummary | null> => {
      const p = await d.resolveProduct(hh, productId);
      if (!p) return null;
      if (p.custom) return p;
      const cat = snapshot.bySku.get(productId);
      return !cat || cat.discontinued || isNotAtStore(cat, today) ? null : p;
    };
    const rows = await matchIngredients(
      parsed,
      {
        templates,
        purchases: purchases satisfies HistoryPurchase[],
        unitOverrides: overrides,
        available,
        search: async (query) =>
          mergeRanked<Searchable>(
            searchProducts<Searchable>(snapshot.index, query, { today }),
            searchProducts<Searchable>(customIndex, query, { today }),
          ).map((r) => ({ item: summaryOf(r.item), score: r.score })),
      },
      (p) => names?.get(parsed.indexOf(p)) ?? p.name,
    );
    const ai = names !== null;
    const cachedAt = await d.recipes.matchCache.put(hh, recipe.id, hash, rows, ai, now.getTime());
    const kept = await d.recipes.matchCache.get(hh, recipe.id, hash, now.getTime());
    return json(200, {
      rows: applyChoices(rows, kept?.choices ?? {}),
      ai,
      cached: false,
      cachedAt,
    } satisfies RecipeMatchResponse);
  }

  /** Remember what the user picked per line, for next time (D-116). Not rate limited. */
  async function saveChoices(req: AuthedRequest): Promise<HttpResult> {
    const hh = req.household.householdId;
    const d = getDeps();
    const id = req.event.pathParameters?.recipeId;
    const recipe = await d.recipes.mustGet(hh, isValidEntityId(id) ? id : fail.notFound());
    const raw = readJsonBody(req.event) as { choices?: unknown } | null;
    const list = raw?.choices;
    if (!Array.isArray(list) || list.length === 0 || list.length > 100) {
      return fail.validation('choices must be 1 to 100 items', 'choices');
    }
    const choices: Record<string, string> = {};
    for (const c of list as Array<{ line?: unknown; choice?: unknown }>) {
      if (
        typeof c?.line !== 'string' ||
        c.line.length === 0 ||
        c.line.length > 500 ||
        typeof c.choice !== 'string' ||
        (c.choice !== TEXT_CHOICE && !isValidEntityId(c.choice) && !/^[\w-]{1,64}$/.test(c.choice))
      ) {
        return fail.validation('Invalid choice', 'choices');
      }
      choices[c.line] = c.choice;
    }
    const now = d.now().getTime();
    await d.recipes.matchCache.saveChoices(
      hh,
      recipe.id,
      ingredientsHash(recipe.ingredients),
      choices,
      now,
    );
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  return {
    'POST /api/recipes/{recipeId}/match': { auth: true, handler: match },
    'PUT /api/recipes/{recipeId}/match/choices': { auth: true, handler: saveChoices },
  };
}
