/**
 * Stage 5 routes (docs/api.md "Recipes", D-103 to D-107). All authed; the household comes
 * only from verified claims and every key is built from it, so another household's recipe
 * id is a plain 404. Photos: presigned POSTs to a private bucket (photos.ts); the recipe
 * stores only the key.
 */
import {
  filterRecipes,
  isValidEntityId,
  parsePatchRecipeRequest,
  parseRecipeInput,
  parseRecipeToListRequest,
  parseUpdateRecipeRequest,
  textLineInput,
  parseLineText,
  type BulkAddItemResult,
  type LineInput,
  type Parsed,
  type RecipesResponse,
  type RecipeToListResponse,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from '../http';
import type { ListStore } from '../lists/store';
import type { AuthedRequest, RouteTable } from '../router';
import { ensureThisWeekList } from '../this-week';
import type { PlanStore } from '../plan/store';
import type { PhotoStore } from './photos';
import type { RecipeStore } from './store';

export interface Stage5Deps {
  recipes: RecipeStore;
  plan: PlanStore;
  photos: PhotoStore;
  lists: ListStore;
  now: () => Date;
}

function unwrap<T>(p: Parsed<T>): T {
  return p.ok ? p.value : fail.validation(p.message, p.field);
}

/** Recipe text fields add up to ~38,000 characters (B1); the default body cap is 16 KB. */
const MAX_BODY_CHARS = 96 * 1024;

export function createRecipeRoutes(getDeps: () => Stage5Deps): RouteTable {
  const hhOf = (req: AuthedRequest) => req.household.householdId;
  const idOf = (req: AuthedRequest) => {
    const id = req.event.pathParameters?.recipeId;
    return isValidEntityId(id) ? id : fail.notFound();
  };
  const body = (req: AuthedRequest): unknown => readJsonBody(req.event, MAX_BODY_CHARS);

  async function list(req: AuthedRequest): Promise<HttpResult> {
    const q = req.event.queryStringParameters ?? {};
    const all = await getDeps().recipes.summaries(hhOf(req));
    return json(200, {
      recipes: filterRecipes(all, {
        q: q.q,
        category: q.category,
        favourite: q.favourite === 'true' || q.favourite === '1',
      }),
    } satisfies RecipesResponse);
  }

  async function create(req: AuthedRequest): Promise<HttpResult> {
    const input = unwrap(parseRecipeInput(body(req), hhOf(req)));
    return json(201, await getDeps().recipes.create(hhOf(req), input));
  }

  async function get(req: AuthedRequest): Promise<HttpResult> {
    return json(200, await getDeps().recipes.mustGet(hhOf(req), idOf(req)));
  }

  async function update(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = idOf(req);
    const input = unwrap(parseUpdateRecipeRequest(body(req), hh));
    const { recipes, photos } = getDeps();
    const { recipe, previousPhotoKey } = await recipes.update(hh, id, input);
    if (previousPhotoKey) await photos.remove(previousPhotoKey);
    return json(200, recipe);
  }

  async function patch(req: AuthedRequest): Promise<HttpResult> {
    const { favourite } = unwrap(parsePatchRecipeRequest(readJsonBody(req.event)));
    return json(200, await getDeps().recipes.setFavourite(hhOf(req), idOf(req), favourite));
  }

  async function remove(req: AuthedRequest): Promise<HttpResult> {
    const { recipes, photos } = getDeps();
    const photoKey = await recipes.delete(hhOf(req), idOf(req));
    if (photoKey) await photos.remove(photoKey);
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function photoUpload(req: AuthedRequest): Promise<HttpResult> {
    return json(200, await getDeps().photos.presign(hhOf(req)));
  }

  /** Ingredient lines -> free-text list lines with bulk add / Undo semantics (F2, F3). */
  async function toList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const userId = req.household.userId;
    const deps = getDeps();
    const recipe = await deps.recipes.mustGet(hh, idOf(req));
    const input = unwrap(parseRecipeToListRequest(body(req)));
    let listId: string;
    let listCreated = false;
    if (input.listId) {
      listId = (await deps.lists.mustGetActive(hh, input.listId)).id;
    } else {
      ({ listId, listCreated } = await ensureThisWeekList(deps, hh, userId));
    }

    const note = `From ${recipe.title}`.slice(0, 200);
    const results: Array<BulkAddItemResult | null> = input.lines.map(() => null);
    const toAdd: Array<{ index: number; line: LineInput }> = [];
    const seen = new Set<string>();
    input.lines.forEach((raw, index) => {
      const text = parseLineText(raw, 'lines');
      if (!text.ok) {
        results[index] = {
          ok: false,
          productId: '',
          unit: 'each',
          code: 'VALIDATION',
          message: text.message,
        };
        return;
      }
      const line = textLineInput(text.value, { note });
      const id = line.product.productId;
      if (seen.has(id)) {
        results[index] = {
          ok: false,
          productId: id,
          unit: 'each',
          code: 'VALIDATION',
          message: 'This line is already in the request.',
        };
        return;
      }
      seen.add(id);
      toAdd.push({ index, line });
    });
    const outcomes = await deps.lists.addEach(
      hh,
      userId,
      listId,
      toAdd.map((t) => t.line),
    );
    outcomes.forEach((o, i) => {
      const { index, line } = toAdd[i] as { index: number; line: LineInput };
      const ref = { productId: line.product.productId, unit: line.unit };
      results[index] = o.ok
        ? { ok: true, ...ref, change: o.change }
        : { ok: false, ...ref, code: o.code, message: o.message };
    });
    const final = results as BulkAddItemResult[];
    const added = final.filter((r) => r.ok).length;
    return json(200, {
      list: await deps.lists.detail(hh, listId),
      results: final,
      added,
      failed: final.length - added,
      listId,
      listCreated,
    } satisfies RecipeToListResponse);
  }

  const r = (handler: (req: AuthedRequest) => Promise<HttpResult>) => ({
    auth: true as const,
    handler,
  });

  return {
    'GET /api/recipes': r(list),
    'POST /api/recipes': r(create),
    'POST /api/recipes/photo-upload': r(photoUpload),
    'GET /api/recipes/{recipeId}': r(get),
    'PUT /api/recipes/{recipeId}': r(update),
    'PATCH /api/recipes/{recipeId}': r(patch),
    'DELETE /api/recipes/{recipeId}': r(remove),
    'POST /api/recipes/{recipeId}/to-list': r(toList),
  };
}
