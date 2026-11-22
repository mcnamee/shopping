import type {
  AisleOrderResponse,
  CreateListResponse,
  GroupsResponse,
  HistoryResponse,
  ListDetail,
  ListItemMutationResponse,
  ListItemUpdateResponse,
  ListsResponse,
  ProductSearchResponse,
  Template,
  TemplatesResponse,
  UnitOverridesResponse,
} from '@trolley/core';
import { DEFAULT_AISLE_ORDER, defaultListName, groupForShop } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, resetMockApi } from './mock';
import { MOCK_SEED_IDS, MOCK_STATE_KEY } from './mock-stage2';

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

const MILK = '000000000000398689';
const BANANAS = '000000000000380234';
const RICE = '000000000000262325';
const SALMON = '000000000000286737';

beforeEach(() => {
  vi.useFakeTimers();
  resetMockApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mock Stage 2 seed data', () => {
  it('seeds a flagged "this week" list with 21 items across groups, 6 ticked', async () => {
    const lists = (await call<ListsResponse>('GET', '/lists')).body.lists;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({
      id: MOCK_SEED_IDS.thisWeekList,
      name: defaultListName(new Date()),
      thisWeek: true,
      itemCount: 21,
      tickedCount: 6,
    });
    const detail = (await call<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`)).body;
    const sections = groupForShop(detail.items, DEFAULT_AISLE_ORDER);
    expect(sections.length).toBeGreaterThanOrEqual(10);
    expect(detail.items.some((i) => i.note)).toBe(true);
    expect(detail.items.some((i) => i.unit === 'kg')).toBe(true);
    expect(detail.items.some((i) => i.product.productId.startsWith('custom-'))).toBe(true);
  });

  it('seeds a weekly and a meal template, and two archived lists in History', async () => {
    const templates = (await call<TemplatesResponse>('GET', '/templates')).body.templates;
    expect(templates.map((t) => [t.name, t.type])).toEqual([
      ['Weekly basics', 'weekly'],
      ['Tacos', 'meal'],
    ]);
    expect(templates[0]?.itemCount).toBe(10);
    expect(templates[0]?.preview).toHaveLength(3);
    const history = (await call<HistoryResponse>('GET', '/history')).body;
    expect(history.lists.map((l) => [l.status, l.itemCount, l.tickedCount])).toEqual([
      ['archived', 12, 11],
      ['archived', 8, 8],
    ]);
  });
});

describe('mock Stage 2 behaviour mirrors the API', () => {
  it('adds to this week with merge, tick-to-archive, Undo and Finish', async () => {
    const add = await call<ListItemMutationResponse>('POST', '/this-week/items', {
      productId: MILK,
      qty: 1,
      unit: 'pack',
    });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({
      merged: true,
      listCreated: false,
      item: { qty: 3, ticked: false },
    });

    const list = (await call<CreateListResponse>('POST', '/lists', { name: 'BBQ' })).body.list;
    expect(list.thisWeek).toBe(false);
    await call('POST', `/lists/${list.id}/items`, { productId: BANANAS, qty: 1, unit: 'kg' });
    await call('POST', `/lists/${list.id}/items`, { productId: RICE, qty: 1, unit: 'pack' });
    const t1 = await call<ListItemUpdateResponse>(
      'PATCH',
      `/lists/${list.id}/items/${BANANAS}~kg`,
      {
        ticked: true,
      },
    );
    expect(t1.body.archived).toBe(false);
    const t2 = await call<ListItemUpdateResponse>('PATCH', `/lists/${list.id}/items/${RICE}~pack`, {
      ticked: true,
    });
    expect(t2.body).toMatchObject({ archived: true, list: { status: 'archived', tickedCount: 2 } });
    expect(
      (await call('POST', `/lists/${list.id}/items`, { productId: MILK, qty: 1, unit: 'pack' }))
        .body,
    ).toMatchObject({
      reason: 'LIST_ARCHIVED',
    });
    const undo = await call<{ list: ListDetail }>('POST', `/lists/${list.id}/reopen`);
    expect(undo.body.list).toMatchObject({ status: 'active', tickedCount: 2, itemCount: 2 });
    const finish = await call<{ list: ListDetail }>('POST', `/lists/${list.id}/finish`);
    expect(finish.body.list).toMatchObject({ status: 'archived', finishedBy: 'finish' });
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect((await call('POST', `/lists/${list.id}/reopen`)).body).toMatchObject({
      reason: 'UNDO_EXPIRED',
    });
  });

  it('creates "Week of" and flags it when no list is flagged (C2)', async () => {
    await call('PATCH', `/lists/${MOCK_SEED_IDS.thisWeekList}`, { thisWeek: false });
    const res = await call<ListItemMutationResponse>('POST', '/this-week/items', {
      productId: SALMON,
      qty: 1,
      unit: 'pack',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ listCreated: true, list: { thisWeek: true, itemCount: 1 } });
  });

  it('creates lists from templates by the merge rule and reports combined lines', async () => {
    const res = await call<CreateListResponse>('POST', '/lists', {
      templateIds: [MOCK_SEED_IDS.weeklyTemplate, MOCK_SEED_IDS.mealTemplate],
    });
    expect(res.status).toBe(201);
    expect(res.body.combined).toBe(2); // milk and rice appear in both
    expect(res.body.list.itemCount).toBe(13);
    expect(res.body.list.items.find((i) => i.id === `${MILK}~pack`)?.qty).toBe(3);
  });

  it('versions edits (409 STALE) and validates like the API', async () => {
    const id = MOCK_SEED_IDS.thisWeekList;
    const item = `${BANANAS}~kg`;
    const ok = await call<ListItemUpdateResponse>('PATCH', `/lists/${id}/items/${item}`, {
      qty: 2,
      version: 2,
    });
    expect(ok.body.item).toMatchObject({ qty: 2, version: 3 });
    expect(
      (await call('PATCH', `/lists/${id}/items/${item}`, { qty: 3, version: 2 })).body,
    ).toMatchObject({
      reason: 'STALE',
      current: { qty: 2 },
    });
    expect((await call('PATCH', `/lists/${id}/items/${item}`, { qty: 3 })).body).toMatchObject({
      field: 'version',
    });
    expect(
      (await call('POST', `/lists/${id}/items`, { productId: MILK, qty: 1.5, unit: 'pack' })).body,
    ).toMatchObject({ field: 'qty' });
    expect(
      (await call('POST', `/lists/${id}/items`, { productId: '424242', qty: 1, unit: 'each' }))
        .body,
    ).toMatchObject({ field: 'productId' });
    expect((await call('POST', '/templates', { name: '' })).body).toMatchObject({
      message: 'Enter a name for this template.',
    });
  });

  it('edits templates: merge on add, item versions, delete', async () => {
    const t = (await call<Template>('POST', '/templates', { name: 'Brekkie', type: 'meal' })).body;
    expect(
      (await call('POST', `/templates/${t.id}/items`, { productId: MILK, qty: 1, unit: 'pack' }))
        .status,
    ).toBe(201);
    const merged = await call<{ item: { qty: number; version: number } }>(
      'POST',
      `/templates/${t.id}/items`,
      {
        productId: MILK,
        qty: 2,
        unit: 'pack',
      },
    );
    expect(merged).toMatchObject({
      status: 200,
      body: { merged: true, item: { qty: 3, version: 2 } },
    });
    expect(
      (await call('PATCH', `/templates/${t.id}/items/${MILK}~pack`, { qty: 1, version: 1 })).body,
    ).toMatchObject({ reason: 'STALE' });
    expect((await call('DELETE', `/templates/${t.id}/items/${MILK}~pack`)).status).toBe(200);
    expect((await call('DELETE', `/templates/${t.id}`)).status).toBe(204);
    expect((await call('GET', `/templates/${t.id}`)).status).toBe(404);
  });

  it('applies the aisle order to GET /api/groups and unit overrides to search', async () => {
    const order = ['frozen', ...DEFAULT_AISLE_ORDER.filter((g) => g !== 'frozen')];
    const put = await call<AisleOrderResponse>('PUT', '/settings/aisle-order', {
      order,
      version: 0,
    });
    expect(put.body).toMatchObject({ isDefault: false, version: 1 });
    expect((await call<GroupsResponse>('GET', '/groups')).body.groups[0]?.id).toBe('frozen');
    expect((await call('PUT', '/settings/aisle-order', { order, version: 0 })).status).toBe(409);
    expect((await call<AisleOrderResponse>('DELETE', '/settings/aisle-order')).body.isDefault).toBe(
      true,
    );

    await call('PUT', `/settings/unit-overrides/${MILK}`, { unit: 'L' });
    const search = (
      await call<ProductSearchResponse>('GET', '/products/search?q=full%20cream%20milk%202l')
    ).body;
    expect(search.items.find((p) => p.sku === MILK)).toMatchObject({
      unitType: 'L',
      defaultUnitType: 'pack',
    });
    const overrides = (await call<UnitOverridesResponse>('GET', '/settings/unit-overrides')).body
      .overrides;
    expect(overrides).toMatchObject([{ productId: MILK, unit: 'L', defaultUnit: 'pack' }]);
    expect((await call('DELETE', `/settings/unit-overrides/${MILK}`)).status).toBe(204);
    expect((await call('DELETE', `/settings/unit-overrides/${MILK}`)).status).toBe(404);
  });

  it('isolates households (404 for guessed ids)', async () => {
    const other = { ...claims, sub: 'user-9', 'custom:householdId': 'home-2' };
    const res = await call('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`, undefined, other);
    // home-2 gets its own seed with the same fixed ids, so check a list home-1 created.
    expect(res.status).toBe(200);
    const mine = (await call<CreateListResponse>('POST', '/lists', { name: 'Mine' })).body.list;
    expect((await call('GET', `/lists/${mine.id}`, undefined, other)).status).toBe(404);
    expect((await call('PATCH', `/lists/${mine.id}`, { thisWeek: true }, other)).status).toBe(404);
  });

  it('has a failure seam and fails like the network when offline', async () => {
    vi.stubGlobal('__mockApiFail', { match: 'PATCH /api/lists/', status: 500 });
    const id = MOCK_SEED_IDS.thisWeekList;
    expect(
      (await call('PATCH', `/lists/${id}/items/${BANANAS}~kg`, { ticked: false })).status,
    ).toBe(500);
    expect(
      (await call('PATCH', `/lists/${id}/items/${BANANAS}~kg`, { ticked: false })).status,
    ).toBe(200);

    vi.stubGlobal('navigator', { onLine: false });
    const promise = mockFetch('/api/lists', { headers: { authorization: token(claims) } });
    const assertion = expect(promise).rejects.toThrow('Failed to fetch');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('persists to localStorage so a reload or a second page sees the same state', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const list = (await call<CreateListResponse>('POST', '/lists', { name: 'Persisted' })).body
      .list;
    expect(store.get(MOCK_STATE_KEY)).toContain('Persisted');
    // Another page writes to storage directly; this page reads it on the next request.
    const state = JSON.parse(store.get(MOCK_STATE_KEY) as string) as {
      households: Record<string, { lists: Array<{ id: string; name: string }> }>;
    };
    const stored = state.households['home-1']?.lists.find((l) => l.id === list.id);
    if (stored) stored.name = 'Renamed elsewhere';
    store.set(MOCK_STATE_KEY, JSON.stringify(state));
    expect((await call<ListDetail>('GET', `/lists/${list.id}`)).body.name).toBe(
      'Renamed elsewhere',
    );
  });
});
