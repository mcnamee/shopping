import {
  COLD_START_NOTE,
  keys,
  purchaseSortKey,
  type BulkAddItemsResponse,
  type BulkUndoResponse,
  type CreateListResponse,
  type ListDetail,
  type SuggestionsResponse,
  type Template,
  type UnitType,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiPrompt } from './ai';
import type { AiTextModel } from './bedrock';
import { RATE_LIMIT_MESSAGE } from './routes';
import { SUGGEST_DAILY_LIMIT } from './store';
import {
  BANANAS,
  BREAD,
  MILK,
  MINCE,
  removeProduct,
  setup,
  T0,
  type Harness,
  type SetupOptions,
} from '../test/harness';

const DAY = 24 * 60 * 60 * 1000;
const RAZORS = '800001'; // "Bulk item 001" in the harness catalogue
let h: Harness;

function init(opts: SetupOptions = {}) {
  h = setup(opts);
}

beforeEach(() => init());

/** YYYY-MM-DD `n` days before T0 (Sun 22 Nov 2026 in Canberra). */
const ago = (n: number) => new Date(T0 - n * DAY).toISOString().slice(0, 10);

async function bought(
  productId: string,
  name: string,
  daysAgo: number,
  qty = 1,
  unit: UnitType = 'pack',
  hh = 'home-1',
) {
  const date = ago(daysAgo);
  const listId = `00000000-0000-4000-8000-${String(daysAgo).padStart(12, '0')}`;
  await h.db.put({
    pk: keys.householdPk(hh),
    sk: purchaseSortKey({ productId, date, listId, unit }),
    entity: 'Purchase',
    productId,
    name,
    groupId: 'pantry',
    qty,
    unit,
    listId,
    completedAt: `${date}T02:00:00.000Z`,
    date,
  });
}

/** Four weekly shops: mince weekly, bread fortnightly, bananas weekly (kg), razors monthly. */
async function seedHistory(hh = 'home-1') {
  for (const d of [7, 14, 21, 28]) await bought(MINCE, 'Beef Mince 500g', d, 1, 'pack', hh);
  for (const d of [14, 28]) await bought(BREAD, 'Wholemeal Bread', d, 2, 'each', hh);
  for (const d of [7, 14, 21]) await bought(BANANAS, 'Cavendish Bananas', d, 1.5, 'kg', hh);
  for (const d of [27, 55]) await bought(RAZORS, 'Bulk item 001', d, 1, 'each', hh);
}

async function newList(items: Array<[string, number, string]> = [], hh?: string) {
  const res = await h.call<CreateListResponse>('POST /api/lists', {
    body: {},
    ...(hh ? { hh } : {}),
  });
  const id = res.body.list.id;
  for (const [productId, qty, unit] of items) {
    await h.call('POST /api/lists/{listId}/items', {
      path: { listId: id },
      body: { productId, qty, unit },
      ...(hh ? { hh } : {}),
    });
  }
  return id;
}

async function weeklyTemplate(items: Array<[string, number, string, string?]>, hh?: string) {
  const t = (
    await h.call<Template>('POST /api/templates', {
      body: { name: 'Weekly basics', type: 'weekly' },
      ...(hh ? { hh } : {}),
    })
  ).body;
  for (const [productId, qty, unit, note] of items) {
    await h.call('POST /api/templates/{templateId}/items', {
      path: { templateId: t.id },
      body: { productId, qty, unit, note },
      ...(hh ? { hh } : {}),
    });
  }
  return t.id;
}

const suggestFor = (listId: string, hh?: string) =>
  h.call<SuggestionsResponse>('POST /api/lists/{listId}/suggestions', {
    path: { listId },
    ...(hh ? { hh } : {}),
  });

const snapshotRows = () =>
  h.table
    .all()
    .filter((i) => !String(i.sk).startsWith('SUGGESTRUNS#'))
    .map((i) => JSON.stringify(i))
    .sort();

describe('POST /api/lists/{listId}/suggestions (rules)', () => {
  it('returns template items then due items, excluding what is on the list, read-only', async () => {
    await seedHistory();
    await weeklyTemplate([[MILK, 2, 'pack', 'Blue top']]);
    const listId = await newList([[BANANAS, 1, 'kg']]);
    const before = snapshotRows();

    const res = await suggestFor(listId);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('rules');
    expect(res.body.coldStart).toBe(false);
    expect(res.body.note).toBeNull();
    expect(res.body.suggestions.map((s) => [s.productId, s.qty, s.unit, s.reason])).toEqual([
      [MILK, 2, 'pack', 'On your weekly template'],
      [MINCE, 1, 'pack', 'Usually every ~7 days, last bought 7 days ago'],
      [BREAD, 2, 'each', 'Usually every ~2 weeks, last bought 14 days ago'],
      [RAZORS, 1, 'each', 'Usually every ~4 weeks, last bought 27 days ago'],
    ]);
    const milk = res.body.suggestions[0];
    expect(milk).toMatchObject({ note: 'Blue top', fromTemplate: true, fromHistory: false });
    // History items carry a catalogue snapshot for display.
    expect(res.body.suggestions[1]).toMatchObject({
      fromTemplate: false,
      fromHistory: true,
      note: null,
      snapshot: {
        productId: MINCE,
        name: 'Beef Mince 500g',
        imageUrl: `https://img.example/${MINCE}.jpg`,
        groupId: 'meat-seafood',
        unitType: 'pack',
      },
    });
    // Bananas is on the list (in kg): excluded.
    expect(res.body.suggestions.some((s) => s.productId === BANANAS)).toBe(false);
    // Nothing but the run counter was written.
    expect(snapshotRows()).toEqual(before);
  });

  it('excludes a product on the list in another unit and when ticked', async () => {
    await seedHistory();
    const listId = await newList([
      [MINCE, 500, 'g'],
      [BREAD, 1, 'each'],
    ]);
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId, itemId: `${BREAD}~each` },
      body: { ticked: true },
    });
    const ids = (await suggestFor(listId)).body.suggestions.map((s) => s.productId);
    expect(ids).not.toContain(MINCE);
    expect(ids).not.toContain(BREAD);
  });

  it('cold start (< 3 archived lists): weekly template items only, with the note, no AI call', async () => {
    let calls = 0;
    init({
      ai: async () => {
        calls += 1;
        return '{}';
      },
    });
    for (const d of [7, 14]) await bought(MINCE, 'Beef Mince 500g', d);
    await weeklyTemplate([[MILK, 2, 'pack']]);
    const listId = await newList();
    const res = await suggestFor(listId);
    expect(res.body).toMatchObject({ source: 'rules', coldStart: true, note: COLD_START_NOTE });
    expect(res.body.suggestions.map((s) => s.productId)).toEqual([MILK]);
    expect(calls).toBe(0);
  });

  it('nothing to suggest: no template, no history', async () => {
    const listId = await newList();
    const res = await suggestFor(listId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ coldStart: true, suggestions: [] });
  });

  it('POST /api/suggestions (no list) excludes nothing', async () => {
    await seedHistory();
    await newList([[MINCE, 1, 'pack']]);
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.suggestions.map((s) => s.productId)).toContain(MINCE);
  });

  it('isolation: another household list is 404 and its history is never used', async () => {
    await seedHistory('home-2');
    const theirs = await newList([], 'home-2');
    expect((await suggestFor(theirs)).status).toBe(404);
    const mine = await newList();
    const res = await suggestFor(mine);
    expect(res.body).toMatchObject({ coldStart: true, suggestions: [] });
    expect((await suggestFor('not-a-uuid')).status).toBe(404);
    expect((await h.call('POST /api/suggestions', { hh: null })).status).toBe(401);
  });

  it('409 LIST_ARCHIVED for an archived list', async () => {
    const listId = await newList([[MILK, 1, 'pack']]);
    await h.call('POST /api/lists/{listId}/finish', { path: { listId } });
    const res = await suggestFor(listId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', reason: 'LIST_ARCHIVED' });
  });

  it('drops a history product that no longer resolves (deleted custom product)', async () => {
    await seedHistory();
    for (const d of [7, 14, 21]) {
      await bought('custom-11111111-1111-4111-8111-111111111111', 'Gone', d);
    }
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.body.suggestions.map((s) => s.productId)).not.toContain(
      'custom-11111111-1111-4111-8111-111111111111',
    );
  });

  it('never suggests a removed (soft-deleted) product, from template or history (D-123)', async () => {
    await seedHistory();
    await weeklyTemplate([[MILK, 2, 'pack']]);
    for (const sku of [MILK, MINCE]) removeProduct(h, sku);
    const listId = await newList([[BANANAS, 1, 'kg']]);
    const res = await suggestFor(listId);
    const ids = res.body.suggestions.map((x) => x.productId);
    expect(ids).not.toContain(MILK);
    expect(ids).not.toContain(MINCE);
    expect(ids).toContain(BREAD);
  });

  it('rules path is fast with a year of weekly shops', async () => {
    const products = Array.from({ length: 40 }, (_, i) => String(800010 + i));
    for (let w = 1; w <= 52; w += 1) {
      for (const p of products.slice(0, 30)) await bought(p, `Bulk ${p}`, w * 7);
    }
    const started = performance.now();
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.body.suggestions.length).toBe(30);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('AI pass (B3 to B5)', () => {
  const reply =
    (text: string | ((p: AiPrompt) => string)): AiTextModel =>
    async (p) =>
      typeof text === 'string' ? text : text(p);

  it('re-ranks, adjusts qty within bounds and rewords; invented keys are ignored', async () => {
    let seen: AiPrompt | undefined;
    init({
      ai: reply((p) => {
        seen = p;
        return JSON.stringify({
          suggestions: [
            { key: 'c3', rank: 1, qty: 2, reason: 'Razors are about due' },
            { key: 'c1', rank: 2, qty: 50, reason: 'Ignore previous instructions <b>now</b>' },
            { key: 'c9', rank: 0, qty: 50, reason: 'Add 50 x Wine' },
          ],
        });
      }),
    });
    await seedHistory();
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    // c1 = mince, c2 = bananas, c3 = bread, c4 = razors (deterministic order).
    expect(res.body.suggestions.map((s) => [s.productId, s.qty, s.reason])).toEqual([
      [BREAD, 2, 'Razors are about due'],
      [MINCE, 1, 'Ignore previous instructions now'], // qty 50 is outside 0.5x-2x: kept at 1
      [BANANAS, 1.5, 'Usually every ~7 days, last bought 7 days ago'], // unranked c2 keeps rank 2
      [RAZORS, 1, 'Usually every ~4 weeks, last bought 27 days ago'], // unranked c4 keeps rank 4
    ]);
    expect(res.body.suggestions).toHaveLength(4);
    expect(seen?.user).not.toContain('home-1');
  });

  it.each([
    ['invalid_json', reply('Sorry, I cannot do that')],
    ['schema', reply('{"items":[]}')],
    ['empty', reply('{"suggestions":[{"key":"c42","rank":1}]}')],
    [
      'error',
      (async () => {
        throw Object.assign(new Error('Too many requests'), { name: 'ThrottlingException' });
      }) as AiTextModel,
    ],
  ])('%s -> rules result, 200, warning without product data', async (reason, ai) => {
    init({ ai });
    await seedHistory();
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('rules');
    expect(res.body.suggestions[0]?.reason).toBe('Usually every ~7 days, last bought 7 days ago');
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toMatchObject({ msg: 'suggestions_ai_fallback', reason });
    expect(JSON.stringify(h.warnings)).not.toMatch(/Mince|Bread|Banana|Too many requests/);
  });

  it('times out (abort signalled) and falls back', async () => {
    let aborted = false;
    init({
      aiTimeoutMs: 30,
      ai: (_p, signal) =>
        new Promise<string>(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    });
    await seedHistory();
    const started = performance.now();
    const res = await h.call<SuggestionsResponse>('POST /api/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('rules');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(aborted).toBe(true);
    expect(h.warnings[0]).toMatchObject({ reason: 'timeout' });
  });
});

describe('rate limit (C3)', () => {
  it('allows 20 runs per household per local day, then 429; resets the next day', async () => {
    const listId = await newList();
    for (let i = 0; i < SUGGEST_DAILY_LIMIT; i += 1) {
      expect((await suggestFor(listId)).status).toBe(200); // cold-start runs count too
    }
    const res = await suggestFor(listId);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: 'RATE_LIMITED', message: RATE_LIMIT_MESSAGE });
    expect((await h.call('POST /api/suggestions')).status).toBe(429);
    // Another household has its own allowance.
    expect((await h.call('POST /api/suggestions', { hh: 'home-2' })).status).toBe(200);
    // Counter row is TTL'd.
    const counter = h.table.all().find((i) => i.sk === `SUGGESTRUNS#2026-11-22`);
    expect(counter).toMatchObject({ pk: 'HH#home-1', runs: SUGGEST_DAILY_LIMIT });
    expect(counter?.ttl).toBeGreaterThan(T0 / 1000);
    // Midnight in Canberra (13:00 UTC) starts a new day.
    h.setClock(Date.parse('2026-11-22T13:00:00.000Z'));
    expect((await suggestFor(listId)).status).toBe(200);
  });

  it('two phones racing for the last run: exactly one wins', async () => {
    const listId = await newList();
    for (let i = 0; i < SUGGEST_DAILY_LIMIT - 1; i += 1) await suggestFor(listId);
    const [a, b] = await Promise.all([suggestFor(listId), suggestFor(listId)]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
  });

  it('a 404 or 409 list does not use a run', async () => {
    await suggestFor('00000000-0000-4000-8000-000000000999');
    expect(h.table.all().some((i) => String(i.sk).startsWith('SUGGESTRUNS#'))).toBe(false);
  });
});

describe('POST /api/lists/{listId}/items/bulk', () => {
  const bulk = (listId: string, items: unknown[], hh?: string) =>
    h.call<BulkAddItemsResponse>('POST /api/lists/{listId}/items/bulk', {
      path: { listId },
      body: { items },
      ...(hh ? { hh } : {}),
    });

  it('adds new rows and merges into existing ones, with per-item results for Undo', async () => {
    const listId = await newList([
      [MILK, 1, 'pack'],
      [MINCE, 1, 'pack'],
    ]);
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId, itemId: `${MILK}~pack` },
      body: { ticked: true },
    });
    const res = await bulk(listId, [
      { productId: MILK, qty: 2, unit: 'pack' },
      { productId: BREAD, qty: 1, unit: 'each', note: 'Sliced' },
      { productId: BANANAS, qty: 1.5, unit: 'kg' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 3, failed: 0 });
    expect(res.body.results).toEqual([
      {
        ok: true,
        productId: MILK,
        unit: 'pack',
        change: { itemId: `${MILK}~pack`, created: false, addedQty: 2, version: 3 },
      },
      {
        ok: true,
        productId: BREAD,
        unit: 'each',
        change: { itemId: `${BREAD}~each`, created: true, addedQty: 1, version: 1 },
      },
      {
        ok: true,
        productId: BANANAS,
        unit: 'kg',
        change: { itemId: `${BANANAS}~kg`, created: true, addedQty: 1.5, version: 1 },
      },
    ]);
    const milk = res.body.list.items.find((i) => i.id === `${MILK}~pack`);
    expect(milk).toMatchObject({ qty: 3, ticked: false }); // merged and unticked (D-053)
    expect(res.body.list.items).toHaveLength(4);

    // Undo exactly those adds: DELETE created rows, PATCH merged rows back.
    for (const r of res.body.results) {
      if (!r.ok) continue;
      const { itemId, created, addedQty, version } = r.change;
      if (created) {
        const del = await h.call('DELETE /api/lists/{listId}/items/{itemId}', {
          path: { listId, itemId },
          query: { version: String(version) },
        });
        expect(del.status).toBe(200);
      } else {
        const item = res.body.list.items.find((i) => i.id === itemId);
        const patch = await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
          path: { listId, itemId },
          body: { qty: (item?.qty ?? 0) - addedQty, version },
        });
        expect(patch.status).toBe(200);
      }
    }
    const after = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body;
    expect(after.items.map((i) => [i.id, i.qty, i.ticked]).sort()).toEqual([
      [`${MILK}~pack`, 1, false],
      [`${MINCE}~pack`, 1, false],
    ]);
  });

  it('undoes a bulk add in one request; a row changed by the other phone is kept', async () => {
    const listId = await newList([
      [MILK, 1, 'pack'],
      [MINCE, 1, 'pack'],
    ]);
    const res = await bulk(listId, [
      { productId: MILK, qty: 2, unit: 'pack' },
      { productId: BREAD, qty: 1, unit: 'each' },
      { productId: BANANAS, qty: 1.5, unit: 'kg' },
    ]);
    const changes = res.body.results.flatMap((r) => (r.ok ? [r.change] : []));
    // The other phone edits the bananas row before Undo.
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId, itemId: `${BANANAS}~kg` },
      body: { qty: 2, version: 1 },
    });
    const undo = await h.call<BulkUndoResponse>('POST /api/lists/{listId}/items/undo', {
      path: { listId },
      body: { changes },
    });
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({ undone: 2, failed: 1 });
    expect(undo.body.results).toEqual([
      { ok: true, itemId: `${MILK}~pack` },
      { ok: true, itemId: `${BREAD}~each` },
      { ok: false, itemId: `${BANANAS}~kg`, code: 'CONFLICT', message: 'Changed on another phone' },
    ]);
    expect(undo.body.list.items.map((i) => [i.id, i.qty]).sort()).toEqual([
      [`${BANANAS}~kg`, 2],
      [`${MILK}~pack`, 1],
      [`${MINCE}~pack`, 1],
    ]);
    // Undo again: created rows already gone count as undone; merged rows are now stale.
    const again = await h.call<BulkUndoResponse>('POST /api/lists/{listId}/items/undo', {
      path: { listId },
      body: { changes: changes.slice(1, 2) },
    });
    expect(again.body.results).toEqual([{ ok: true, itemId: `${BREAD}~each` }]);
  });

  it('undo validates its body and the household', async () => {
    const listId = await newList([[MILK, 1, 'pack']]);
    const change = { itemId: `${MILK}~pack`, created: false, addedQty: 1, version: 1 };
    const undo = (body: unknown, hh?: string) =>
      h.call('POST /api/lists/{listId}/items/undo', {
        path: { listId },
        body,
        ...(hh ? { hh } : {}),
      });
    expect((await undo({ changes: [] })).status).toBe(400);
    expect((await undo({ changes: [change, change] })).status).toBe(400);
    expect((await undo({ changes: [{ ...change, itemId: 'x' }] })).status).toBe(400);
    expect((await undo({ changes: [{ ...change, version: 0 }] })).status).toBe(400);
    expect((await undo({ changes: [change] }, 'home-2')).status).toBe(404);
  });

  it('reports per-item failures and still adds the rest', async () => {
    const listId = await newList([[MILK, 998, 'pack']]);
    const res = await bulk(listId, [
      { productId: BREAD, qty: 1, unit: 'each' },
      { productId: MILK, qty: 2, unit: 'pack' }, // over the 999 max
      { productId: '999999', qty: 1, unit: 'each' }, // not in the catalogue
      { productId: BANANAS, qty: 1.234, unit: 'kg' }, // bad precision
      { productId: BREAD, qty: 1, unit: 'each' }, // duplicate in the request
      'nonsense',
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1, failed: 5 });
    expect(res.body.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual([
      'ok',
      'VALIDATION',
      'VALIDATION',
      'VALIDATION',
      'VALIDATION',
      'VALIDATION',
    ]);
    expect(res.body.results[1]).toMatchObject({
      productId: MILK,
      message: expect.stringMatching(/999/),
    });
    expect(res.body.list.items.map((i) => i.id).sort()).toEqual([`${MILK}~pack`, `${BREAD}~each`]);
  });

  it('fills the list to 200 and reports LIMIT for the rest', async () => {
    const listId = await newList();
    const first = Array.from({ length: 50 }, (_, i) => ({
      productId: String(800000 + i),
      qty: 1,
      unit: 'each',
    }));
    for (let b = 0; b < 3; b += 1) {
      const res = await bulk(
        listId,
        first.map((x, i) => ({ ...x, productId: String(800000 + b * 50 + i) })),
      );
      expect(res.body.added).toBe(50);
    }
    const res = await bulk(
      listId,
      Array.from({ length: 50 }, (_, i) => ({
        productId: String(800150 + i),
        qty: 1,
        unit: 'each',
      })),
    );
    expect(res.body.added).toBe(50);
    const over = await bulk(listId, [
      { productId: '800000', qty: 1, unit: 'each' }, // merge: fits
      { productId: '800210', qty: 1, unit: 'each' }, // new: list full
    ]);
    expect(over.body.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok', 'LIMIT']);
  });

  it('validates the request shape, the list and the household', async () => {
    const listId = await newList();
    expect(
      (await h.call('POST /api/lists/{listId}/items/bulk', { path: { listId }, body: {} })).status,
    ).toBe(400);
    expect((await bulk(listId, [])).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => ({ productId: MILK, qty: 1, unit: 'pack' }));
    expect((await bulk(listId, tooMany)).status).toBe(400);
    expect((await bulk(listId, [{ productId: MILK, qty: 1, unit: 'pack' }], 'home-2')).status).toBe(
      404,
    );
    await h.call('POST /api/lists/{listId}/finish', { path: { listId } });
    const archived = await bulk(listId, [{ productId: MILK, qty: 1, unit: 'pack' }]);
    expect(archived.status).toBe(409);
    expect(archived.body).toMatchObject({ reason: 'LIST_ARCHIVED' });
  });
});
