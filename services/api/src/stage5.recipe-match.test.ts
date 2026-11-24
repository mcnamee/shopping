import {
  keys,
  purchaseSortKey,
  type CatalogueProduct,
  type Recipe,
  type RecipeMatchResponse,
  type Template,
  type UnitType,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { RECIPE_MATCH_DAILY_LIMIT } from './suggestions/store';
import { MINCE, product, setup, T0, type Harness } from './test/harness';

const OLIVE = '910001';
const TOMATO_A = '910002';
const TOMATO_B = '910003';
const GONE = '910004';

const EXTRA: CatalogueProduct[] = [
  product(OLIVE, 'Extra Virgin Olive Oil 750ml', 'pantry', 'each', { packSize: '750 mL' }),
  product(TOMATO_A, 'Diced Tomatoes 400g', 'pantry', 'each'),
  product(TOMATO_B, 'Cherry Tomatoes 250g', 'fruit-veg', 'each'),
  product(GONE, 'Wasabi Peas 200g', 'pantry', 'each', { discontinued: true }),
];

let h: Harness;
beforeEach(() => {
  h = setup({ extraProducts: EXTRA });
});

async function recipe(ingredients: string, hh?: string, title = 'Test dish') {
  const res = await h.call<Recipe>('POST /api/recipes', {
    body: { title, ingredients },
    ...(hh ? { hh } : {}),
  });
  expect(res.status).toBe(201);
  return res.body;
}

const match = (id: string, hh?: string) =>
  h.call<RecipeMatchResponse>('POST /api/recipes/{recipeId}/match', {
    path: { recipeId: id },
    ...(hh ? { hh } : {}),
  });

async function bought(
  productId: string,
  name: string,
  daysAgo: number,
  qty: number,
  unit: UnitType,
  hh = 'home-1',
) {
  const date = new Date(T0 - daysAgo * 86_400_000).toISOString().slice(0, 10);
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

describe('POST /api/recipes/{id}/match', () => {
  it('matches a confident catalogue product with 1 of its default unit, headings skipped', async () => {
    const r = await recipe(
      '# Dressing\n2 tbsp extra virgin olive oil, plus extra\n# Mains\n500g beef mince',
    );
    const res = await match(r.id);
    expect(res.status).toBe(200);
    expect(res.body.ai).toBe(false);
    expect(res.body.rows.map((x) => x.line)).toEqual([
      '2 tbsp extra virgin olive oil, plus extra',
      '500g beef mince',
    ]);
    expect(res.body.rows[0]).toMatchObject({
      name: 'olive oil',
      pantry: false,
      match: {
        productId: OLIVE,
        name: 'Extra Virgin Olive Oil 750ml',
        packSize: '750 mL',
        imageUrl: `https://img.example/${OLIVE}.jpg`,
        unit: 'each',
        qty: 1,
        source: 'catalogue',
      },
    });
    expect(res.body.rows[1]?.match).toMatchObject({ productId: MINCE, unit: 'pack' });
  });

  it('uses the household template qty and unit before history and catalogue', async () => {
    await bought(MINCE, 'Beef Mince 500g', 7, 1, 'pack');
    const t = (
      await h.call<Template>('POST /api/templates', { body: { name: 'Weekly', type: 'weekly' } })
    ).body;
    await h.call('POST /api/templates/{templateId}/items', {
      path: { templateId: t.id },
      body: { productId: MINCE, qty: 3, unit: 'pack' },
    });
    const r = await recipe('500g beef mince');
    const row = (await match(r.id)).body.rows[0];
    expect(row?.match).toMatchObject({
      productId: MINCE,
      source: 'template',
      qty: 3,
      unit: 'pack',
    });
  });

  it('uses the usual product from purchase history with its last qty and unit', async () => {
    await bought(OLIVE, 'Extra Virgin Olive Oil 750ml', 14, 1, 'each');
    await bought(OLIVE, 'Extra Virgin Olive Oil 750ml', 7, 2, 'each');
    const r = await recipe('1 tbsp olive oil');
    expect((await match(r.id)).body.rows[0]?.match).toMatchObject({
      productId: OLIVE,
      source: 'history',
      qty: 2,
      unit: 'each',
    });
  });

  it('keeps unmatched and ambiguous lines as text, offering alternatives', async () => {
    const r = await recipe('1 dragon fruit foam\n400g tomatoes\n1 can chopped tomatoes');
    const rows = (await match(r.id)).body.rows;
    expect(rows[0]).toMatchObject({ match: null, alternatives: [] });
    expect(rows[1]?.match).toBeNull();
    expect(rows[1]?.alternatives.map((a) => a.productId).sort()).toEqual(
      [TOMATO_B, TOMATO_A].sort(),
    );
    expect(rows[2]?.match).toBeNull();
    expect(rows[2]?.alternatives.length).toBeGreaterThan(0);
  });

  it('flags pantry staples', async () => {
    const r = await recipe('Salt and pepper, to taste\n1 cup water\n2 tbsp olive oil');
    expect((await match(r.id)).body.rows.map((x) => x.pantry)).toEqual([true, true, false]);
  });

  it('never offers discontinued products', async () => {
    const r = await recipe('200g wasabi peas');
    expect((await match(r.id)).body.rows[0]).toMatchObject({ match: null, alternatives: [] });
  });

  it('is read-only: no list is created', async () => {
    const r = await recipe('1 tbsp olive oil');
    await match(r.id);
    const lists = await h.call<{ lists: unknown[] }>('GET /api/lists');
    expect(lists.body.lists).toEqual([]);
  });

  it('returns no rows for a recipe without ingredients', async () => {
    const r = await recipe('');
    expect((await match(r.id)).body).toEqual({ rows: [], ai: false });
  });

  it("is household-scoped: another household's recipe is 404 and its data is never used", async () => {
    const mine = await recipe('500g beef mince');
    expect((await match(mine.id, 'home-2')).status).toBe(404);
    expect((await match('not-an-id')).status).toBe(404);
    // home-2's history and templates do not leak into home-1's match.
    await bought(MINCE, 'Beef Mince 500g', 7, 5, 'pack', 'home-2');
    const row = (await match(mine.id)).body.rows[0];
    expect(row?.match).toMatchObject({ source: 'catalogue', qty: 1 });
    const theirs = await recipe('500g beef mince', 'home-2');
    expect((await match(theirs.id, 'home-2')).body.rows[0]?.match).toMatchObject({
      source: 'history',
      qty: 5,
    });
    expect(
      (
        await h.call('POST /api/recipes/{recipeId}/match', {
          hh: null,
          path: { recipeId: mine.id },
        })
      ).status,
    ).toBe(401);
  });

  it('rate-limits per household per day, separately from suggestions', async () => {
    const r = await recipe('1 egg');
    for (let i = 0; i < RECIPE_MATCH_DAILY_LIMIT; i++) {
      expect((await match(r.id)).status).toBe(200);
    }
    const limited = await match(r.id);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    // Another household and the suggestions budget are unaffected.
    const other = await recipe('1 egg', 'home-2');
    expect((await match(other.id, 'home-2')).status).toBe(200);
    expect((await h.call('POST /api/suggestions')).status).toBe(200);
    h.advance(24 * 60 * 60 * 1000);
    expect((await match(r.id)).status).toBe(200);
  });
});

describe('AI clean-up of unsure lines (D-115)', () => {
  const LINE = '1 tbsp extra virgin olive oil or vegetable oil';

  it('uses a valid reply for unsure lines only, with product text as data', async () => {
    const prompts: string[] = [];
    h = setup({
      extraProducts: EXTRA,
      ai: async (p) => {
        prompts.push(p.user);
        return '```json\n{"items":[{"key":"i1","name":"Extra Virgin Olive Oil"}]}\n```';
      },
    });
    const r = await recipe(`${LINE}\n2 tbsp olive oil`);
    const res = await match(r.id);
    expect(res.body.ai).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('<lines>');
    expect(prompts[0]).toContain('vegetable oil');
    expect(prompts[0]).not.toContain('2 tbsp olive oil');
    expect(res.body.rows[0]?.name).toBe('extra virgin olive oil');
    expect(res.body.rows[0]?.match?.productId).toBe(OLIVE);
    expect(res.body.rows[1]?.name).toBe('olive oil');
  });

  it('makes no model call when every line is confident', async () => {
    let calls = 0;
    h = setup({ extraProducts: EXTRA, ai: async () => (calls++, '{}') });
    const r = await recipe('2 tbsp olive oil');
    expect((await match(r.id)).body.ai).toBe(false);
    expect(calls).toBe(0);
  });

  it.each([
    ['invalid JSON', async () => 'sorry'],
    ['wrong schema', async () => '{"rows":[]}'],
    ['unrelated name', async () => '{"items":[{"key":"i1","name":"chicken breast"}]}'],
    ['unknown key', async () => '{"items":[{"key":"zz","name":"olive oil"}]}'],
    ['markup in name', async () => '{"items":[{"key":"i1","name":"<b>olive oil</b>"}]}'],
    [
      'the model throws',
      async () => {
        throw new Error('boom');
      },
    ],
  ])('falls back to the rule parser when %s', async (_label, ai) => {
    h = setup({ extraProducts: EXTRA, ai });
    const r = await recipe(LINE);
    const res = await match(r.id);
    expect(res.status).toBe(200);
    expect(res.body.ai).toBe(false);
    expect(res.body.rows[0]?.name).toBe('extra virgin olive oil'.replace('extra virgin ', ''));
    expect(h.warnings.some((w) => w.msg === 'recipe_match_ai_fallback')).toBe(true);
  });

  it('falls back on a timeout', async () => {
    h = setup({
      extraProducts: EXTRA,
      aiTimeoutMs: 20,
      ai: () => new Promise<string>(() => {}),
    });
    const r = await recipe(LINE);
    const res = await match(r.id);
    expect(res.body.ai).toBe(false);
    expect(h.warnings.find((w) => w.msg === 'recipe_match_ai_fallback')).toMatchObject({
      reason: 'timeout',
    });
    expect(JSON.stringify(h.warnings)).not.toContain('vegetable');
  });
});
