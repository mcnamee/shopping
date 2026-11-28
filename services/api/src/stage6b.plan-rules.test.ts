import {
  PLAN_RULE_LIMITS,
  type MealPlanResponse,
  type PlanRule,
  type PlanRulesResponse,
  type Recipe,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

const ABSENT = '99999999-2222-4333-8444-555555555555';
const FRI = '2026-11-27';
const THU = '2026-12-03';

const rule = (over: Record<string, unknown> = {}) => ({
  kind: 'text',
  text: 'Pizza',
  meal: 'dinner',
  weekday: 5,
  everyWeeks: 1,
  startDate: FRI,
  ...over,
});
const add = (body: Record<string, unknown>, hh?: string) =>
  h.call<PlanRule>('POST /api/plan-rules', { body, ...(hh ? { hh } : {}) });
const made = async (over: Record<string, unknown> = {}, hh?: string) => {
  const res = await add(rule(over), hh);
  expect(res.status).toBe(201);
  return res.body;
};
const plan = (from: string, to: string, hh?: string) =>
  h.call<MealPlanResponse>('GET /api/plan', { query: { from, to }, ...(hh ? { hh } : {}) });
const skip = (r: PlanRule, date: string, hh?: string) =>
  h.call('PUT /api/plan-rules/{ruleId}/skips/{date}', {
    path: { ruleId: r.id, date },
    ...(hh ? { hh } : {}),
  });
const unskip = (r: PlanRule, date: string) =>
  h.call('DELETE /api/plan-rules/{ruleId}/skips/{date}', { path: { ruleId: r.id, date } });

describe('recurring rule CRUD', () => {
  it('creates, lists and replaces with a version', async () => {
    const r = await made({ note: 'Friday treat' });
    expect(r).toMatchObject({ kind: 'text', text: 'Pizza', weekday: 5, version: 1, paused: false });
    const list = await h.call<PlanRulesResponse>('GET /api/plan-rules', {});
    expect(list.body.rules).toHaveLength(1);
    const upd = (body: Record<string, unknown>) =>
      h.call<PlanRule>('PUT /api/plan-rules/{ruleId}', { path: { ruleId: r.id }, body });
    const ok = await upd({ ...rule({ text: 'Pizza night', paused: true }), version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ text: 'Pizza night', paused: true, version: 2 });
    expect(ok.body.note).toBeUndefined();
    const stale = await upd({ ...rule(), version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'STALE', current: { version: 2 } });
    expect((await upd(rule())).status).toBe(400);
  });

  it('validates the body and the recipe', async () => {
    expect((await add(rule({ weekday: 4 }))).body).toMatchObject({ field: 'startDate' });
    expect((await add(rule({ everyWeeks: 5 }))).status).toBe(400);
    expect((await add(rule({ endDate: '2026-11-01' }))).body).toMatchObject({ field: 'endDate' });
    expect((await add(rule({ kind: 'recipe', recipeId: ABSENT }))).body).toMatchObject({
      field: 'recipeId',
    });
    const rec = (
      await h.call<Recipe>('POST /api/recipes', { body: { title: 'Pizza', ingredients: '1 base' } })
    ).body;
    expect((await add(rule({ kind: 'recipe', recipeId: rec.id }))).status).toBe(201);
  });

  it('caps rules per household (409 LIMIT) and counts households separately', async () => {
    for (let i = 0; i < PLAN_RULE_LIMITS.perHousehold; i++) await made();
    const over = await add(rule());
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ reason: 'LIMIT' });
    expect((await add(rule(), 'home-2')).status).toBe(201);
  });

  it('deletes a rule and its skips, then 404s', async () => {
    const r = await made();
    await skip(r, FRI);
    const del = () => h.call('DELETE /api/plan-rules/{ruleId}', { path: { ruleId: r.id } });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
    expect((await plan(FRI, '2026-12-10')).body.occurrences).toEqual([]);
  });

  it('keeps households apart (404 for another household, nothing in its plan)', async () => {
    const r = await made();
    const path = { ruleId: r.id };
    expect((await h.call('GET /api/plan-rules', { hh: 'home-2' })).body).toEqual({ rules: [] });
    expect(
      (
        await h.call('PUT /api/plan-rules/{ruleId}', {
          path,
          body: { ...rule(), version: 1 },
          hh: 'home-2',
        })
      ).status,
    ).toBe(404);
    expect((await h.call('DELETE /api/plan-rules/{ruleId}', { path, hh: 'home-2' })).status).toBe(
      404,
    );
    expect((await skip(r, FRI, 'home-2')).status).toBe(404);
    expect((await plan(FRI, '2026-12-10', 'home-2')).body.occurrences).toEqual([]);
    expect((await h.call('GET /api/plan-rules', { hh: null })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /plan merges occurrences', () => {
  it('returns entries and occurrences, sorted, with the recurring flag and ruleId', async () => {
    const weekly = await made();
    const lunch = await made({ text: 'Soup', meal: 'lunch' });
    await h.call('POST /api/plan', {
      body: { date: FRI, kind: 'text', text: 'One-off', meal: 'dinner' },
    });
    const res = await plan('2026-11-23', '2026-12-06');
    expect(res.body.entries.map((e) => e.text)).toEqual(['One-off']);
    expect(res.body.occurrences.map((o) => `${o.date} ${o.text}`)).toEqual([
      `${FRI} Soup`,
      `${FRI} Pizza`,
      '2026-12-04 Soup',
      '2026-12-04 Pizza',
    ]);
    expect(res.body.occurrences[1]).toMatchObject({
      recurring: true,
      ruleId: weekly.id,
      meal: 'dinner',
    });
    expect(res.body.occurrences[0]?.ruleId).toBe(lunch.id);
  });

  it('honours every-2-weeks parity, bounds and paused', async () => {
    await made({ text: 'Wraps', weekday: 4, everyWeeks: 2, startDate: THU, endDate: '2026-12-31' });
    await made({ text: 'Paused', paused: true });
    const days = async (from: string, to: string) =>
      (await plan(from, to)).body.occurrences.map((o) => o.date);
    expect(await days('2026-11-23', '2026-12-06')).toEqual([THU]);
    expect(await days('2026-12-07', '2026-12-13')).toEqual([]);
    expect(await days('2026-12-14', '2026-12-20')).toEqual(['2026-12-17']);
    expect(await days('2026-12-28', '2027-01-10')).toEqual(['2026-12-31']);
  });
});

describe('skips', () => {
  it('skips one occurrence and unskips it again, idempotently', async () => {
    const r = await made();
    expect((await skip(r, '2026-12-04')).status).toBe(204);
    expect((await skip(r, '2026-12-04')).status).toBe(204);
    const dates = async () => (await plan(FRI, '2026-12-11')).body.occurrences.map((o) => o.date);
    expect(await dates()).toEqual([FRI, '2026-12-11']);
    expect((await unskip(r, '2026-12-04')).status).toBe(204);
    expect(await dates()).toEqual([FRI, '2026-12-04', '2026-12-11']);
    expect((await unskip(r, '2026-12-04')).status).toBe(204);
  });

  it('rejects a skip on a date that is not an occurrence and unknown rules', async () => {
    const r = await made({ weekday: 4, everyWeeks: 2, startDate: THU });
    expect((await skip(r, '2026-12-10')).status).toBe(400);
    expect((await skip(r, '2026-12-04')).status).toBe(400);
    expect((await skip(r, 'nope')).status).toBe(404);
    expect(
      (
        await h.call('PUT /api/plan-rules/{ruleId}/skips/{date}', {
          path: { ruleId: ABSENT, date: THU },
        })
      ).status,
    ).toBe(404);
  });

  it('a one-off entry on a skipped day coexists ("change this week only")', async () => {
    const r = await made();
    await skip(r, FRI);
    await h.call('POST /api/plan', {
      body: { date: FRI, kind: 'text', text: 'Curry', meal: 'dinner' },
    });
    const res = (await plan(FRI, FRI)).body;
    expect(res.occurrences).toEqual([]);
    expect(res.entries.map((e) => e.text)).toEqual(['Curry']);
  });
});
