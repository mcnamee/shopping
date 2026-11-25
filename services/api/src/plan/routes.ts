/**
 * Stage 6 routes (docs/api.md "Meal plan", D-117 to D-121). All authed; the household comes
 * only from verified claims and every key is built from it, so another household's entry is
 * a plain 404. The date is part of the key, so it is part of the path.
 */
import {
  isPlanDate,
  isValidEntityId,
  parseCreatePlanEntry,
  parseMovePlanEntry,
  parsePlanRange,
  parseUpdatePlanEntry,
  type MealPlanResponse,
  type Parsed,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from '../http';
import type { AuthedRequest, RouteTable } from '../router';
import type { RecipeStore } from '../recipes/store';
import type { PlanStore } from './store';

export interface PlanDeps {
  plan: PlanStore;
  recipes: RecipeStore;
}

function unwrap<T>(p: Parsed<T>): T {
  return p.ok ? p.value : fail.validation(p.message, p.field);
}

export function createPlanRoutes(getDeps: () => PlanDeps): RouteTable {
  const hhOf = (req: AuthedRequest) => req.household.householdId;
  const target = (req: AuthedRequest) => {
    const { date, entryId } = req.event.pathParameters ?? {};
    return isPlanDate(date) && isValidEntityId(entryId) ? { date, id: entryId } : fail.notFound();
  };

  async function range(req: AuthedRequest): Promise<HttpResult> {
    const { from, to } = unwrap(parsePlanRange(req.event.queryStringParameters ?? {}));
    const entries = await getDeps().plan.range(hhOf(req), from, to);
    return json(200, { entries } satisfies MealPlanResponse);
  }

  async function create(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const input = unwrap(parseCreatePlanEntry(readJsonBody(req.event)));
    const { plan, recipes } = getDeps();
    if (input.kind === 'recipe' && !(await recipes.get(hh, input.recipeId as string))) {
      return fail.validation('That recipe no longer exists.', 'recipeId');
    }
    return json(201, await plan.create(hh, input));
  }

  async function update(req: AuthedRequest): Promise<HttpResult> {
    const { date, id } = target(req);
    const patch = unwrap(parseUpdatePlanEntry(readJsonBody(req.event)));
    return json(200, await getDeps().plan.update(hhOf(req), date, id, patch));
  }

  async function move(req: AuthedRequest): Promise<HttpResult> {
    const { date, id } = target(req);
    const to = unwrap(parseMovePlanEntry(readJsonBody(req.event)));
    return json(200, await getDeps().plan.move(hhOf(req), date, id, to));
  }

  async function remove(req: AuthedRequest): Promise<HttpResult> {
    const { date, id } = target(req);
    await getDeps().plan.delete(hhOf(req), date, id);
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  const r = (handler: (req: AuthedRequest) => Promise<HttpResult>) => ({
    auth: true as const,
    handler,
  });
  return {
    'GET /api/plan': r(range),
    'POST /api/plan': r(create),
    'PATCH /api/plan/{date}/{entryId}': r(update),
    'POST /api/plan/{date}/{entryId}/move': r(move),
    'DELETE /api/plan/{date}/{entryId}': r(remove),
  };
}
