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
  fallsOnRule,
  parsePlanRange,
  parsePlanRule,
  parseUpdatePlanRule,
  parseUpdatePlanEntry,
  type MealPlanResponse,
  type PlanRulesResponse,
  type Parsed,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from '../http';
import type { AuthedRequest, RouteTable } from '../router';
import type { RecipeStore } from '../recipes/store';
import type { PlanRuleStore } from './rules-store';
import type { PlanStore } from './store';

export interface PlanDeps {
  plan: PlanStore;
  rules: PlanRuleStore;
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
    const { plan, rules } = getDeps();
    const [entries, occurrences] = await Promise.all([
      plan.range(hhOf(req), from, to),
      rules.occurrences(hhOf(req), from, to),
    ]);
    return json(200, { entries, occurrences } satisfies MealPlanResponse);
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

  // ---- Recurring meals (docs/stages/stage-6b.md)
  const ruleId = (req: AuthedRequest) => {
    const id = req.event.pathParameters?.ruleId;
    return isValidEntityId(id) ? id : fail.notFound();
  };
  const skipTarget = (req: AuthedRequest) => {
    const date = req.event.pathParameters?.date;
    return { id: ruleId(req), date: isPlanDate(date) ? date : fail.notFound() };
  };

  async function checkRecipe(hh: string, input: { kind: string; recipeId?: string }) {
    if (input.kind === 'recipe' && !(await getDeps().recipes.get(hh, input.recipeId as string))) {
      fail.validation('That recipe no longer exists.', 'recipeId');
    }
  }

  async function listRules(req: AuthedRequest): Promise<HttpResult> {
    const rules = await getDeps().rules.list(hhOf(req));
    return json(200, { rules } satisfies PlanRulesResponse);
  }

  async function createRule(req: AuthedRequest): Promise<HttpResult> {
    const input = unwrap(parsePlanRule(readJsonBody(req.event)));
    await checkRecipe(hhOf(req), input);
    return json(201, await getDeps().rules.create(hhOf(req), input));
  }

  async function replaceRule(req: AuthedRequest): Promise<HttpResult> {
    const id = ruleId(req);
    const input = unwrap(parseUpdatePlanRule(readJsonBody(req.event)));
    await checkRecipe(hhOf(req), input);
    return json(200, await getDeps().rules.replace(hhOf(req), id, input));
  }

  async function removeRule(req: AuthedRequest): Promise<HttpResult> {
    await getDeps().rules.delete(hhOf(req), ruleId(req));
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function skip(req: AuthedRequest): Promise<HttpResult> {
    const { id, date } = skipTarget(req);
    const rule = await getDeps().rules.mustGet(hhOf(req), id);
    if (!fallsOnRule(rule, date)) {
      return fail.validation('That meal does not fall on this day.', 'date');
    }
    await getDeps().rules.skip(hhOf(req), id, date);
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function unskip(req: AuthedRequest): Promise<HttpResult> {
    const { id, date } = skipTarget(req);
    await getDeps().rules.mustGet(hhOf(req), id);
    await getDeps().rules.unskip(hhOf(req), id, date);
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
    'GET /api/plan-rules': r(listRules),
    'POST /api/plan-rules': r(createRule),
    'PUT /api/plan-rules/{ruleId}': r(replaceRule),
    'DELETE /api/plan-rules/{ruleId}': r(removeRule),
    'PUT /api/plan-rules/{ruleId}/skips/{date}': r(skip),
    'DELETE /api/plan-rules/{ruleId}/skips/{date}': r(unskip),
  };
}
