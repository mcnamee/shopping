// @vitest-environment jsdom
import {
  addDays,
  MEAL_PLAN_LIMITS,
  storeToday,
  type MealPlanEntry,
  type MealPlanResponse,
} from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, resetMockApi } from './mock';
import { MOCK_RECIPE_IDS } from './mock-stage5';

const claims = { sub: 'user-1', email: 'a@example.com', 'custom:householdId': 'home-1' };
const token = `Bearer mock.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const promise = mockFetch(`/api${path}`, {
    method,
    headers: { authorization: token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  await vi.runAllTimersAsync();
  const res = await promise;
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

const mon = () => storeToday();
const range = () => `/plan?from=${mon()}&to=${addDays(mon(), 6)}`;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetMockApi();
});
afterEach(() => vi.useRealTimers());

describe('mock meal plan (Stage 6)', () => {
  it('is seeded with a sample week in day and slot order', async () => {
    const res = await call<MealPlanResponse>('GET', range());
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(4);
    expect(res.body.entries.map((e) => e.date)).toEqual(
      [...res.body.entries.map((e) => e.date)].sort(),
    );
    expect(res.body.entries[0]).toMatchObject({
      kind: 'recipe',
      recipeId: MOCK_RECIPE_IDS.lambCurry,
    });
    expect(
      (
        await call<MealPlanResponse>(
          'GET',
          `/plan?from=${addDays(mon(), 7)}&to=${addDays(mon(), 13)}`,
        )
      ).body.entries,
    ).toEqual([]);
  });

  it('adds, edits, moves and deletes with versions', async () => {
    const date = addDays(mon(), 5);
    const made = await call<MealPlanEntry>('POST', '/plan', {
      date,
      meal: 'lunch',
      kind: 'text',
      text: 'Pizza',
    });
    expect(made.status).toBe(201);
    const e = made.body;
    const upd = await call<MealPlanEntry>('PATCH', `/plan/${date}/${e.id}`, {
      version: 1,
      note: 'Friday',
    });
    expect(upd.body).toMatchObject({ note: 'Friday', version: 2 });
    expect((await call('PATCH', `/plan/${date}/${e.id}`, { version: 1, note: 'x' })).status).toBe(
      409,
    );
    const to = addDays(mon(), 6);
    const mv = await call<MealPlanEntry>('POST', `/plan/${date}/${e.id}/move`, {
      version: 2,
      date: to,
      meal: 'dinner',
    });
    expect(mv.body).toMatchObject({ date: to, meal: 'dinner', version: 3 });
    expect((await call('DELETE', `/plan/${date}/${e.id}`)).status).toBe(404);
    expect((await call('DELETE', `/plan/${to}/${e.id}`)).status).toBe(204);
  });

  it('limits a day and rejects an unknown recipe', async () => {
    const date = addDays(mon(), 3);
    for (let i = 0; i < MEAL_PLAN_LIMITS.perDay; i += 1) {
      await call('POST', '/plan', { date, kind: 'text', text: `t${i}` });
    }
    expect((await call('POST', '/plan', { date, kind: 'text', text: 'x' })).status).toBe(409);
    expect(
      (
        await call('POST', '/plan', {
          date: mon(),
          kind: 'recipe',
          recipeId: '99999999-2222-4333-8444-555555555555',
        })
      ).status,
    ).toBe(400);
  });
});

describe('mock recurring meals (Stage 6b)', () => {
  it('is seeded with Pizza weekly and Chicken wraps fortnightly, merged into GET /plan', async () => {
    const rules = await call<{ rules: Array<{ text: string; everyWeeks: number }> }>(
      'GET',
      '/plan-rules',
    );
    expect(rules.body.rules.map((r) => [r.text, r.everyWeeks])).toEqual([
      ['Pizza', 1],
      ['Chicken wraps', 2],
    ]);
    const week = await call<MealPlanResponse>('GET', range());
    expect(week.body.occurrences.map((o) => o.text).sort()).toEqual(['Chicken wraps', 'Pizza']);
    const later = await call<MealPlanResponse>(
      'GET',
      `/plan?from=${addDays(mon(), 7)}&to=${addDays(mon(), 13)}`,
    );
    expect(later.body.occurrences.map((o) => o.text)).toEqual(['Pizza']);
  });

  it('skips and unskips an occurrence, and validates the rule', async () => {
    const week = (await call<MealPlanResponse>('GET', range())).body;
    const pizza = week.occurrences.find((o) => o.text === 'Pizza');
    if (!pizza) throw new Error('no pizza');
    const path = `/plan-rules/${pizza.ruleId}/skips/${pizza.date}`;
    expect((await call('PUT', path)).status).toBe(204);
    expect((await call<MealPlanResponse>('GET', range())).body.occurrences).toHaveLength(1);
    expect((await call('DELETE', path)).status).toBe(204);
    expect((await call<MealPlanResponse>('GET', range())).body.occurrences).toHaveLength(2);
    expect(
      (await call('PUT', `/plan-rules/${pizza.ruleId}/skips/${addDays(pizza.date, 1)}`)).status,
    ).toBe(400);
    const rule = {
      kind: 'text',
      text: 'X',
      weekday: 5,
      everyWeeks: 1,
      startDate: pizza.date,
    };
    const stale = await call('PUT', `/plan-rules/${pizza.ruleId}`, { ...rule, version: 9 });
    expect(stale.status).toBe(409);
    expect((await call('PUT', `/plan-rules/${pizza.ruleId}`, { ...rule, version: 1 })).status).toBe(
      200,
    );
    expect((await call('DELETE', `/plan-rules/${pizza.ruleId}`)).status).toBe(204);
    expect((await call<MealPlanResponse>('GET', range())).body.occurrences).toHaveLength(1);
  });
});
