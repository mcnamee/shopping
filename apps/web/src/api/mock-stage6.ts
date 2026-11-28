/**
 * Stage 6 mock API (meal plan) for VITE_MOCK_AUTH. Mirrors services/api/src/plan with the
 * same @trolley/core validation. Entries live in the Stage 2 mock household state, seeded on
 * first use with a sample week (this week, Canberra Monday to Sunday).
 */
import {
  addDays,
  expandOccurrences,
  fallsOnRule,
  nextWeekdayOnOrAfter,
  parsePlanRule,
  parseUpdatePlanRule,
  PLAN_RULE_LIMITS,
  skipKey,
  isPlanDate,
  isValidEntityId,
  MEAL_PLAN_LIMITS,
  parseCreatePlanEntry,
  parseMovePlanEntry,
  parsePlanRange,
  parseUpdatePlanEntry,
  sortPlanEntries,
  storeToday,
  type MealPlanEntry,
  type MealPlanResponse,
  type PlanRule,
  type PlanRulesResponse,
} from '@trolley/core';
import {
  clone,
  conflict,
  invalid,
  json,
  newId,
  notFound,
  nowIso,
  read,
  unwrap,
  write,
  type MockHousehold,
} from './mock-stage2';
import { MOCK_RECIPE_IDS, recipesOf } from './mock-stage5';

function seedPlan(): MealPlanEntry[] {
  const mon = storeToday();
  const at = nowIso();
  const e = (
    n: number,
    day: number,
    meal: MealPlanEntry['meal'],
    rest: Partial<MealPlanEntry>,
  ): MealPlanEntry => ({
    id: `00000000-0000-4000-8000-0000000000d${n}`,
    date: addDays(mon, day),
    meal,
    kind: 'text',
    order: 0,
    version: 1,
    createdAt: at,
    updatedAt: at,
    ...rest,
  });
  return [
    e(1, 0, 'dinner', { kind: 'recipe', recipeId: MOCK_RECIPE_IDS.lambCurry }),
    e(2, 1, 'lunch', { text: 'Leftovers', note: 'Lamb curry' }),
    e(3, 2, 'dinner', { kind: 'recipe', recipeId: MOCK_RECIPE_IDS.greekSalad }),
    e(4, 4, 'dinner', { text: 'Eat out' }),
  ];
}

/** Pizza every Friday dinner; Chicken wraps every 2nd Thursday dinner (next Thursday onwards). */
function seedRules(): PlanRule[] {
  const at = nowIso();
  const base = { kind: 'text' as const, meal: 'dinner' as const, paused: false, version: 1 };
  return [
    {
      ...base,
      id: '00000000-0000-4000-8000-0000000000e1',
      text: 'Pizza',
      weekday: 5,
      everyWeeks: 1,
      startDate: nextWeekdayOnOrAfter(storeToday(), 5),
      createdAt: at,
      updatedAt: at,
    },
    {
      ...base,
      id: '00000000-0000-4000-8000-0000000000e2',
      text: 'Chicken wraps',
      weekday: 4,
      everyWeeks: 2,
      startDate: nextWeekdayOnOrAfter(storeToday(), 4),
      createdAt: at,
      updatedAt: at,
    },
  ];
}

const rulesOf = (hh: MockHousehold): PlanRule[] => (hh.planRules ??= seedRules());
const skipsOf = (hh: MockHousehold): string[] => (hh.planSkips ??= []);

function ruleParam(hh: MockHousehold, params: Record<string, string>): PlanRule {
  const id = params.ruleId;
  if (!isValidEntityId(id)) return notFound();
  return rulesOf(hh).find((r) => r.id === id) ?? notFound();
}

function checkRecipe(hh: MockHousehold, input: { kind: string; recipeId?: string }): void {
  if (input.kind === 'recipe' && !recipesOf(hh).some((r) => r.id === input.recipeId)) {
    invalid('That recipe no longer exists.', 'recipeId');
  }
}

function planOf(hh: MockHousehold): MealPlanEntry[] {
  hh.plan ??= seedPlan();
  return hh.plan;
}

function find(hh: MockHousehold, params: Record<string, string>): MealPlanEntry {
  const { date, entryId } = params;
  if (!isPlanDate(date) || !isValidEntityId(entryId)) return notFound();
  return planOf(hh).find((e) => e.id === entryId && e.date === date) ?? notFound();
}

const view = (e: MealPlanEntry): MealPlanEntry => {
  const c = clone(e);
  if (!c.note) delete c.note;
  return c;
};

function nextOrder(entries: MealPlanEntry[], date: string, skip?: string): number {
  return (
    Math.max(-1, ...entries.filter((e) => e.date === date && e.id !== skip).map((e) => e.order)) + 1
  );
}

function checkRoom(entries: MealPlanEntry[], date: string): void {
  if (entries.filter((e) => e.date === date).length >= MEAL_PLAN_LIMITS.perDay) {
    conflict('LIMIT', `A day can have up to ${MEAL_PLAN_LIMITS.perDay} entries. Remove one first.`);
  }
}

export function createStage6MockRoutes() {
  return {
    'GET /api/plan': read((hh, { url }) => {
      const { from, to } = unwrap(
        parsePlanRange({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
        }),
      );
      const days = new Set<string>();
      const inRange = planOf(hh).filter((e) => e.date >= from && e.date <= to);
      inRange.forEach((e) => days.add(e.date));
      const entries = [...days]
        .sort()
        .flatMap((d) => sortPlanEntries(inRange.filter((e) => e.date === d)).map(view));
      const occurrences = expandOccurrences(rulesOf(hh), new Set(skipsOf(hh)), from, to);
      return json(200, { entries, occurrences } satisfies MealPlanResponse);
    }),
    'POST /api/plan': write((hh, { body }) => {
      const input = unwrap(parseCreatePlanEntry(body));
      if (input.kind === 'recipe' && !recipesOf(hh).some((r) => r.id === input.recipeId)) {
        invalid('That recipe no longer exists.', 'recipeId');
      }
      const all = planOf(hh);
      checkRoom(all, input.date);
      const at = nowIso();
      const e: MealPlanEntry = {
        id: newId(),
        date: input.date,
        meal: input.meal,
        kind: input.kind,
        ...(input.recipeId ? { recipeId: input.recipeId } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.note ? { note: input.note } : {}),
        order: input.order ?? nextOrder(all, input.date),
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      all.push(e);
      return json(201, view(e));
    }),
    'PATCH /api/plan/{date}/{entryId}': write((hh, { params, body }) => {
      const e = find(hh, params);
      const patch = unwrap(parseUpdatePlanEntry(body));
      if (patch.version !== e.version) conflict('STALE', 'Changed on another phone', view(e));
      if (patch.text !== undefined) {
        if (e.kind !== 'text') invalid('Only text entries have text.', 'text');
        e.text = patch.text;
      }
      if (patch.note !== undefined) {
        if (patch.note) e.note = patch.note;
        else delete e.note;
      }
      e.version += 1;
      e.updatedAt = nowIso();
      return json(200, view(e));
    }),
    'POST /api/plan/{date}/{entryId}/move': write((hh, { params, body }) => {
      const e = find(hh, params);
      const to = unwrap(parseMovePlanEntry(body));
      if (to.version !== e.version) conflict('STALE', 'Changed on another phone', view(e));
      const all = planOf(hh);
      const sameDay = to.date === e.date;
      if (!sameDay) checkRoom(all, to.date);
      const order =
        to.order ?? (sameDay && to.meal === e.meal ? e.order : nextOrder(all, to.date, e.id));
      Object.assign(e, {
        date: to.date,
        meal: to.meal,
        order,
        version: e.version + 1,
        updatedAt: nowIso(),
      });
      return json(200, view(e));
    }),
    'DELETE /api/plan/{date}/{entryId}': write((hh, { params }) => {
      const e = find(hh, params);
      hh.plan = planOf(hh).filter((x) => x !== e);
      return json(204, null);
    }),
    'GET /api/plan-rules': read((hh) =>
      json(200, { rules: rulesOf(hh).map(clone) } satisfies PlanRulesResponse),
    ),
    'POST /api/plan-rules': write((hh, { body }) => {
      const input = unwrap(parsePlanRule(body));
      checkRecipe(hh, input);
      if (rulesOf(hh).length >= PLAN_RULE_LIMITS.perHousehold) {
        conflict(
          'LIMIT',
          `You can have up to ${PLAN_RULE_LIMITS.perHousehold} recurring meals. Remove one first.`,
        );
      }
      const at = nowIso();
      const rule: PlanRule = { ...input, id: newId(), version: 1, createdAt: at, updatedAt: at };
      rulesOf(hh).push(rule);
      return json(201, clone(rule));
    }),
    'PUT /api/plan-rules/{ruleId}': write((hh, { params, body }) => {
      const current = ruleParam(hh, params);
      const { version, ...input } = unwrap(parseUpdatePlanRule(body));
      checkRecipe(hh, input);
      if (version !== current.version)
        conflict('STALE', 'Changed on another phone', clone(current));
      const next: PlanRule = {
        ...input,
        id: current.id,
        version: current.version + 1,
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      };
      hh.planRules = rulesOf(hh).map((r) => (r === current ? next : r));
      return json(200, clone(next));
    }),
    'DELETE /api/plan-rules/{ruleId}': write((hh, { params }) => {
      const rule = ruleParam(hh, params);
      hh.planRules = rulesOf(hh).filter((r) => r !== rule);
      hh.planSkips = skipsOf(hh).filter((k) => !k.startsWith(`${rule.id}#`));
      return json(204, null);
    }),
    'PUT /api/plan-rules/{ruleId}/skips/{date}': write((hh, { params }) => {
      const rule = ruleParam(hh, params);
      const { date } = params;
      if (!isPlanDate(date)) return notFound();
      if (!fallsOnRule(rule, date)) invalid('That meal does not fall on this day.', 'date');
      const key = skipKey(rule.id, date);
      if (!skipsOf(hh).includes(key)) skipsOf(hh).push(key);
      return json(204, null);
    }),
    'DELETE /api/plan-rules/{ruleId}/skips/{date}': write((hh, { params }) => {
      const rule = ruleParam(hh, params);
      const { date } = params;
      if (!isPlanDate(date)) return notFound();
      hh.planSkips = skipsOf(hh).filter((k) => k !== skipKey(rule.id, date));
      return json(204, null);
    }),
  };
}
