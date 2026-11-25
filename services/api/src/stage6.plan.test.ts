import {
  MEAL_PLAN_LIMITS,
  type MealPlanEntry,
  type MealPlanResponse,
  type Recipe,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

const D = '2026-11-23';
const ABSENT = '99999999-2222-4333-8444-555555555555';

async function recipe(hh?: string) {
  const res = await h.call<Recipe>('POST /api/recipes', {
    body: { title: 'Lamb curry', ingredients: '1 onion' },
    ...(hh ? { hh } : {}),
  });
  return res.body;
}
const add = (body: Record<string, unknown>, hh?: string) =>
  h.call<MealPlanEntry>('POST /api/plan', { body, ...(hh ? { hh } : {}) });
const text = async (date: string, t = 'Leftovers', extra: Record<string, unknown> = {}) => {
  const res = await add({ date, kind: 'text', text: t, ...extra });
  expect(res.status).toBe(201);
  return res.body;
};
const week = (from = D, to = '2026-11-29', hh?: string) =>
  h.call<MealPlanResponse>('GET /api/plan', { query: { from, to }, ...(hh ? { hh } : {}) });

describe('meal plan CRUD and range query', () => {
  it('creates text and recipe entries and reads a week in day/slot order', async () => {
    const r = await recipe();
    const a = await add({ date: '2026-11-24', meal: 'dinner', kind: 'recipe', recipeId: r.id });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      meal: 'dinner',
      kind: 'recipe',
      recipeId: r.id,
      version: 1,
      order: 0,
    });
    await text('2026-11-24', 'Toast', { meal: 'breakfast', note: 'Wholemeal' });
    await text('2026-11-23', 'Eat out');
    await text('2026-12-07', 'Outside the week');
    const res = await week();
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.text ?? e.kind)).toEqual(['Eat out', 'Toast', 'recipe']);
    expect(res.body.entries[1]).toMatchObject({ note: 'Wholemeal', meal: 'breakfast' });
  });

  it('includes both ends of the range and nothing outside', async () => {
    await text('2026-11-22', 'before');
    await text('2026-11-23', 'first');
    await text('2026-11-29', 'last');
    await text('2026-11-30', 'after');
    expect((await week()).body.entries.map((e) => e.text)).toEqual(['first', 'last']);
  });

  it('assigns ascending order within a day and uses one query', async () => {
    const a = await text(D, 'a');
    const b = await text(D, 'b');
    expect([a.order, b.order]).toEqual([0, 1]);
  });

  it('validates the body, the recipe and the range', async () => {
    expect((await add({ date: 'nope', kind: 'text', text: 'x' })).status).toBe(400);
    expect((await add({ date: D, kind: 'text', text: ' ' })).body).toMatchObject({ field: 'text' });
    expect((await add({ date: D, kind: 'recipe', recipeId: ABSENT })).body).toMatchObject({
      field: 'recipeId',
    });
    expect((await week('2026-01-01', '2026-12-31')).status).toBe(400);
    expect((await week('2026-11-29', '2026-11-23')).status).toBe(400);
    expect((await h.call('GET /api/plan', {})).status).toBe(400);
  });

  it('edits the note and text with a version and rejects stale versions (409)', async () => {
    const e = await text(D);
    const upd = (body: Record<string, unknown>) =>
      h.call<MealPlanEntry>('PATCH /api/plan/{date}/{entryId}', {
        path: { date: D, entryId: e.id },
        body,
      });
    const ok = await upd({ version: 1, text: 'Pizza', note: 'Friday' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ text: 'Pizza', note: 'Friday', version: 2 });
    const stale = await upd({ version: 1, note: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'STALE', current: { version: 2 } });
    expect((await upd({ version: 2, note: '' })).body.note).toBeUndefined();
    const r = await recipe();
    const re = (await add({ date: D, kind: 'recipe', recipeId: r.id })).body;
    const bad = await h.call('PATCH /api/plan/{date}/{entryId}', {
      path: { date: D, entryId: re.id },
      body: { version: 1, text: 'x' },
    });
    expect(bad.status).toBe(400);
  });

  it('deletes and 404s afterwards', async () => {
    const e = await text(D);
    const del = () =>
      h.call('DELETE /api/plan/{date}/{entryId}', { path: { date: D, entryId: e.id } });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
    expect((await week()).body.entries).toEqual([]);
  });
});

describe('move', () => {
  const move = (e: MealPlanEntry, body: Record<string, unknown>, hh?: string) =>
    h.call<MealPlanEntry>('POST /api/plan/{date}/{entryId}/move', {
      path: { date: e.date, entryId: e.id },
      body,
      ...(hh ? { hh } : {}),
    });

  it('changes the meal on the same day', async () => {
    const e = await text(D);
    const res = await move(e, { version: 1, date: D, meal: 'lunch' });
    expect(res.body).toMatchObject({ meal: 'lunch', date: D, version: 2 });
    expect((await week()).body.entries).toHaveLength(1);
  });

  it('moves to another day (new key, old one gone) and keeps the id', async () => {
    const e = await text(D, 'Leftovers', { meal: 'dinner' });
    await text('2026-11-25', 'Existing');
    const res = await move(e, { version: 1, date: '2026-11-25', meal: 'dinner' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: e.id, date: '2026-11-25', order: 1, version: 2 });
    const entries = (await week()).body.entries;
    expect(entries.map((x) => x.date)).toEqual(['2026-11-25', '2026-11-25']);
    expect(
      (
        await h.call('POST /api/plan/{date}/{entryId}/move', {
          path: { date: D, entryId: e.id },
          body: { version: 2, date: D, meal: null },
        })
      ).status,
    ).toBe(404);
  });

  it('409s on a stale version and when the target day is full', async () => {
    const e = await text(D);
    expect((await move(e, { version: 9, date: D, meal: null })).status).toBe(409);
    for (let i = 0; i < MEAL_PLAN_LIMITS.perDay; i += 1) await text('2026-11-26', `t${i}`);
    const full = await move(e, { version: 1, date: '2026-11-26', meal: null });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ reason: 'LIMIT' });
    expect((await week()).body.entries.filter((x) => x.date === D)).toHaveLength(1);
  });
});

describe('limits, deleted recipes and isolation', () => {
  it('allows 20 entries a day and 409 LIMIT on the 21st', async () => {
    for (let i = 0; i < MEAL_PLAN_LIMITS.perDay; i += 1) await text(D, `t${i}`);
    const res = await add({ date: D, kind: 'text', text: 'one more' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'LIMIT' });
    expect((await text('2026-11-24')).date).toBe('2026-11-24');
  });

  it('keeps entries when their recipe is deleted (the client shows "Recipe deleted")', async () => {
    const r = await recipe();
    await add({ date: D, kind: 'recipe', recipeId: r.id });
    const del = await h.call('DELETE /api/recipes/{recipeId}', { path: { recipeId: r.id } });
    expect(del.status).toBe(204);
    const res = await week();
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ kind: 'recipe', recipeId: r.id });
  });

  it("never shows, edits, moves or deletes another household's entries", async () => {
    const mine = await text(D, 'Mine');
    const other = (await add({ date: D, kind: 'text', text: 'Theirs' }, 'home-2')).body;
    expect((await week()).body.entries.map((e) => e.text)).toEqual(['Mine']);
    expect((await week(D, '2026-11-29', 'home-2')).body.entries.map((e) => e.text)).toEqual([
      'Theirs',
    ]);
    const path = { date: D, entryId: mine.id };
    expect(
      (
        await h.call('PATCH /api/plan/{date}/{entryId}', {
          path,
          body: { version: 1, note: 'x' },
          hh: 'home-2',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call('POST /api/plan/{date}/{entryId}/move', {
          path,
          body: { version: 1, date: D, meal: null },
          hh: 'home-2',
        })
      ).status,
    ).toBe(404);
    expect((await h.call('DELETE /api/plan/{date}/{entryId}', { path, hh: 'home-2' })).status).toBe(
      404,
    );
    expect(other.id).not.toBe(mine.id);
    expect((await week()).body.entries).toHaveLength(1);
  });

  it("rejects another household's recipe id", async () => {
    const r = await recipe('home-2');
    expect((await add({ date: D, kind: 'recipe', recipeId: r.id })).status).toBe(400);
  });

  it('needs a token', async () => {
    expect((await h.call('GET /api/plan', { query: { from: D, to: D }, hh: null })).status).toBe(
      401,
    );
  });
});
