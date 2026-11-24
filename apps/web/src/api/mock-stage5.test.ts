// @vitest-environment jsdom
import type {
  BulkUndoResponse,
  ListDetail,
  ListItemUpdateResponse,
  Recipe,
  RecipeMatchResponse,
  RecipePhotoUploadResponse,
  RecipesResponse,
  RecipeToListResponse,
} from '@trolley/core';
import { ingredientTexts, parseIngredientLines, textLineId } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPendingTicks, enqueueTick, replayTicks, resetTickQueue } from '../offline/tickQueue';
import { mockFetch, resetMockApi } from './mock';
import { MOCK_RECIPE_IDS } from './mock-stage5';
import { uploadRecipePhoto } from './recipePhotos';

const claims = { sub: 'user-1', email: 'a@example.com', 'custom:householdId': 'home-1' };
const token = (c: Record<string, string>) =>
  `Bearer mock.${btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  c: Record<string, string> = claims,
): Promise<{ status: number; body: T }> {
  const promise = mockFetch(`/api${path}`, {
    method,
    headers: { authorization: token(c) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  await vi.runAllTimersAsync();
  const res = await promise;
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetMockApi();
  resetTickQueue();
});
afterEach(() => vi.useRealTimers());

describe('mock recipes (Stage 5)', () => {
  it('seeds four recipes, three with # headings, favourite and categories', async () => {
    const res = await call<RecipesResponse>('GET', '/recipes');
    expect(res.body.recipes.map((r) => r.title)).toEqual([
      'Fluffy pancakes',
      'Greek salad',
      'Lamb curry',
      'Toast with Vegemite',
    ]);
    const lamb = (await call<Recipe>('GET', `/recipes/${MOCK_RECIPE_IDS.lambCurry}`)).body;
    expect(parseIngredientLines(lamb.ingredients).filter((l) => l.kind === 'heading')).toHaveLength(
      2,
    );
    expect(lamb.favourite).toBe(true);
    expect(
      (await call<RecipesResponse>('GET', '/recipes?favourite=true')).body.recipes,
    ).toHaveLength(1);
    expect(
      (await call<RecipesResponse>('GET', '/recipes?category=salad')).body.recipes,
    ).toHaveLength(1);
    expect((await call<RecipesResponse>('GET', '/recipes?q=PANCAKE')).body.recipes).toHaveLength(1);
  });

  it('creates, updates with versions (409), toggles favourite and deletes', async () => {
    const created = await call<Recipe>('POST', '/recipes', {
      title: 'Soup',
      ingredients: '1 onion',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call('POST', '/recipes', { title: '' })).status).toBe(400);
    const put = await call<Recipe>('PUT', `/recipes/${id}`, { title: 'Pumpkin soup', version: 1 });
    expect(put.body).toMatchObject({ title: 'Pumpkin soup', version: 2 });
    expect((await call('PUT', `/recipes/${id}`, { title: 'x', version: 1 })).status).toBe(409);
    const fav = await call<Recipe>('PATCH', `/recipes/${id}`, { favourite: true });
    expect(fav.body).toMatchObject({ favourite: true, version: 2 });
    expect((await call('DELETE', `/recipes/${id}`)).status).toBe(204);
    expect((await call('GET', `/recipes/${id}`)).status).toBe(404);
  });

  it('keeps households apart', async () => {
    const other = { ...claims, 'custom:householdId': 'home-2' };
    await call('POST', '/recipes', { title: 'Only mine' });
    const theirs = await call<RecipesResponse>('GET', '/recipes', undefined, other);
    expect(theirs.body.recipes.map((r) => r.title)).not.toContain('Only mine');
    expect(
      (await call('GET', `/recipes/${MOCK_RECIPE_IDS.lambCurry}`, undefined, other)).status,
    ).toBe(200); // each household has its own seeded copy
  });
});

describe('mock photo upload (B4)', () => {
  it('presigns, uploads via the helper and shows the photo on the saved recipe', async () => {
    const up = (await call<RecipePhotoUploadResponse>('POST', '/recipes/photo-upload')).body;
    expect(up.photoKey).toMatch(/^recipes\/home-1\//);
    expect(up.full.maxBytes).toBe(3 * 1024 * 1024);
    const uploading = uploadRecipePhoto(
      up,
      new Blob(['full'], { type: 'image/jpeg' }),
      new Blob(['t'], { type: 'image/jpeg' }),
    );
    await vi.runAllTimersAsync(); // FileReader callbacks run on timers
    await uploading;
    const r = (
      await call<Recipe>('POST', '/recipes', { title: 'With photo', photoKey: up.photoKey })
    ).body;
    expect(r.photoUrl).toMatch(/^data:/);
    expect(r.thumbUrl).toMatch(/^data:/);
    const removed = (
      await call<Recipe>('PUT', `/recipes/${r.id}`, {
        title: 'With photo',
        version: 1,
        photoKey: null,
      })
    ).body;
    expect(removed).toMatchObject({ photoKey: null, photoUrl: null });
  });

  it('refuses over-size files and a photoKey from another household', async () => {
    const up = (await call<RecipePhotoUploadResponse>('POST', '/recipes/photo-upload')).body;
    await expect(
      uploadRecipePhoto(up, new Blob([new Uint8Array(3 * 1024 * 1024 + 1)]), new Blob(['t'])),
    ).rejects.toThrow(/too large/);
    const other = { ...claims, 'custom:householdId': 'home-2' };
    const key = (
      await call<RecipePhotoUploadResponse>('POST', '/recipes/photo-upload', undefined, other)
    ).body.photoKey;
    expect((await call('POST', '/recipes', { title: 'x', photoKey: key })).status).toBe(400);
  });
});

describe('mock to-list and free-text lines (D-103)', () => {
  const lines = ingredientTexts(
    '# Curry\n500g lamb shoulder, diced\n2 large onions, sliced\n# To serve\n1 bunch coriander',
  );

  async function send(texts: string[], extra: Record<string, unknown> = {}) {
    return call<RecipeToListResponse>('POST', `/recipes/${MOCK_RECIPE_IDS.lambCurry}/to-list`, {
      lines: texts,
      ...extra,
    });
  }

  it("adds to this week's list as text lines with note and guessed group, merging identical text", async () => {
    const res = await send(lines);
    expect(res.body).toMatchObject({ added: 3, failed: 0, listCreated: false });
    const lamb = res.body.list.items.find((i) => i.id === textLineId(lines[0] as string));
    expect(lamb).toMatchObject({
      kind: 'text',
      note: 'From Lamb curry',
      qty: 1,
      unit: 'each',
      ticked: false,
    });
    expect(lamb?.product.groupId).toBe('meat-seafood');
    const before = res.body.list.items.length;
    await call(
      'PATCH',
      `/lists/${res.body.listId}/items/${encodeURIComponent(textLineId(lines[0] as string))}`,
      {
        ticked: true,
      },
    );
    const again = await send([lines[0] as string]);
    expect(again.body.list.items).toHaveLength(before);
    expect(
      again.body.list.items.find((i) => i.id === textLineId(lines[0] as string)),
    ).toMatchObject({
      ticked: false,
      note: 'From Lamb curry',
    });
    expect(again.body.results[0]).toMatchObject({ ok: true, change: { created: false } });
  });

  it('creates and flags this week when there is none, and undoes through bulk undo', async () => {
    const lists = (await call<{ lists: Array<{ id: string }> }>('GET', '/lists')).body.lists;
    for (const l of lists) await call('DELETE', `/lists/${l.id}`);
    const res = await send(['2 carrots']);
    expect(res.body).toMatchObject({ listCreated: true, added: 1 });
    expect(res.body.list.thisWeek).toBe(true);
    const change = res.body.results.flatMap((r) => (r.ok ? [r.change] : []));
    const undo = await call<BulkUndoResponse>('POST', `/lists/${res.body.listId}/items/undo`, {
      changes: change,
    });
    expect(undo.body).toMatchObject({ undone: 1, failed: 0 });
    expect(undo.body.list.items).toHaveLength(0);
  });

  it('reports per-line problems and limits lines per request', async () => {
    const res = await send(['ok', '  ', 'x'.repeat(201), 'ok']);
    expect(res.body.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual([
      'ok',
      'VALIDATION',
      'VALIDATION',
      'VALIDATION',
    ]);
    expect((await send([])).status).toBe(400);
    expect(
      (
        await call('POST', '/recipes/00000000-0000-4000-8000-0000000000ff/to-list', {
          lines: ['a'],
        })
      ).status,
    ).toBe(404);
  });

  it('ticks, edits (re-key, group), deletes and archives without purchase rows', async () => {
    const res = await send(['2 cups plain flour']);
    const listId = res.body.listId;
    const id = textLineId('2 cups plain flour');
    const path = (itemId: string) => `/lists/${listId}/items/${encodeURIComponent(itemId)}`;
    const edited = await call<ListItemUpdateResponse>('PATCH', path(id), {
      text: '3 cups plain flour',
      groupId: 'bakery',
      version: 1,
    });
    expect(edited.body.replacedItemId).toBe(id);
    expect(edited.body.item.product).toMatchObject({
      name: '3 cups plain flour',
      groupId: 'bakery',
    });
    expect((await call('PATCH', path(id), { ticked: true })).status).toBe(404);
    expect((await call('PATCH', path(edited.body.item.id), { qty: 2, version: 2 })).status).toBe(
      400,
    );
    // Tick everything: the list auto-archives and no purchase is recorded for text lines.
    const detail = (await call<ListDetail>('GET', `/lists/${listId}`)).body;
    let archived = false;
    for (const i of detail.items) {
      archived = (await call<ListItemUpdateResponse>('PATCH', path(i.id), { ticked: true })).body
        .archived;
    }
    expect(archived).toBe(true);
    const suggestions = await call<{ suggestions: Array<{ productId: string }> }>(
      'POST',
      '/suggestions',
    );
    expect(suggestions.body.suggestions.some((s) => s.productId.startsWith('TEXT~'))).toBe(false);
    const state = JSON.parse(localStorage.getItem('trolley.mock.stage2.v1') ?? '{}') as {
      households: Record<string, { purchases: Record<string, { productId: string }> }>;
    };
    expect(
      Object.values(state.households['home-1']?.purchases ?? {}).some((p) =>
        p.productId.startsWith('TEXT~'),
      ),
    ).toBe(false);
  });

  it('offline tick queue overlays and replays ticks for a text line', async () => {
    const res = await send(['2 cups plain flour']);
    const id = textLineId('2 cups plain flour');
    enqueueTick({ listId: res.body.listId, itemId: id, ticked: true });
    const overlaid = applyPendingTicks(res.body.list);
    expect(overlaid.items.find((i) => i.id === id)?.ticked).toBe(true);
    const sent: string[] = [];
    const replay = await replayTicks(async (t) => {
      const r = await call('PATCH', `/lists/${t.listId}/items/${encodeURIComponent(t.itemId)}`, {
        ticked: t.ticked,
      });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      sent.push(t.itemId);
    });
    expect(replay).toMatchObject({ sent: 1, dropped: 0, stopped: false });
    expect(sent).toEqual([id]);
    const after = (await call<ListDetail>('GET', `/lists/${res.body.listId}`)).body;
    expect(after.items.find((i) => i.id === id)?.ticked).toBe(true);
  });
});

describe('POST /recipes/{id}/match (D-115)', () => {
  it('runs the real matcher over the mock catalogue', async () => {
    const res = await call<RecipeMatchResponse>(
      'POST',
      `/recipes/${MOCK_RECIPE_IDS.greekSalad}/match`,
    );
    expect(res.status).toBe(200);
    const oil = res.body.rows.find((r) => r.line === '3 tbsp olive oil');
    expect(oil).toMatchObject({
      name: 'olive oil',
      pantry: false,
      match: { name: 'Extra Virgin Olive Oil 750ml', qty: 1, unit: 'each', source: 'catalogue' },
    });
    expect(res.body.rows.find((r) => r.line === '1 tsp dried oregano')?.match).toBeNull();
    expect(res.body.rows).toHaveLength(
      ingredientTexts(
        (await call<Recipe>('GET', `/recipes/${MOCK_RECIPE_IDS.greekSalad}`)).body.ingredients,
      ).length,
    );
  });

  it('404s an unknown recipe', async () => {
    const res = await call('POST', '/recipes/00000000-0000-4000-8000-00000000dead/match');
    expect(res.status).toBe(404);
  });
});
