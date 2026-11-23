import type {
  CreateListResponse,
  HistoryResponse,
  ListArchiveResponse,
  ListDetail,
  ListItemMutationResponse,
  ListItemUpdateResponse,
  ListsResponse,
  ListSummary,
  Template,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BANANAS, BREAD, ICE_CREAM, MILK, MINCE, setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

async function newList(body: Record<string, unknown> = {}, hh?: string) {
  const res = await h.call<CreateListResponse>('POST /api/lists', { body, ...(hh ? { hh } : {}) });
  expect(res.status).toBe(201);
  return res.body.list;
}

async function add(listId: string, productId: string, qty: number, unit: string, note?: string) {
  return h.call<ListItemMutationResponse>('POST /api/lists/{listId}/items', {
    path: { listId },
    body: { productId, qty, unit, ...(note !== undefined ? { note } : {}) },
  });
}

async function tick(
  listId: string,
  itemId: string,
  ticked = true,
  extra: Record<string, unknown> = {},
) {
  return h.call<ListItemUpdateResponse>('PATCH /api/lists/{listId}/items/{itemId}', {
    path: { listId, itemId },
    body: { ticked, ...extra },
  });
}

const getList = async (listId: string) =>
  (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body;

async function template(
  name: string,
  type: 'weekly' | 'meal',
  items: Array<[string, number, string, string?]>,
) {
  const t = (await h.call<Template>('POST /api/templates', { body: { name, type } })).body;
  for (const [productId, qty, unit, note] of items) {
    await h.call('POST /api/templates/{templateId}/items', {
      path: { templateId: t.id },
      body: { productId, qty, unit, note },
    });
  }
  return t.id;
}

describe('lists: create, flag, rename, delete', () => {
  it('creates a blank "Week of <Monday>" list and flags the first list (D2, D4)', async () => {
    const list = await newList();
    expect(list).toMatchObject({
      name: 'Week of 23 Nov',
      status: 'active',
      thisWeek: true,
      itemCount: 0,
      tickedCount: 0,
      completedAt: null,
      version: 1,
      items: [],
    });
    const second = await newList({ name: 'BBQ' });
    expect(second.thisWeek).toBe(false);
    const lists = (await h.call<ListsResponse>('GET /api/lists')).body.lists;
    expect(lists.map((l) => [l.name, l.thisWeek])).toEqual([
      ['Week of 23 Nov', true],
      ['BBQ', false],
    ]);
  });

  it('flagging one list clears the other in one write (D4)', async () => {
    const a = await newList();
    const b = await newList({ name: 'B', thisWeek: true });
    expect(b.thisWeek).toBe(true);
    expect((await getList(a.id)).thisWeek).toBe(false);
    const res = await h.call<ListSummary>('PATCH /api/lists/{listId}', {
      path: { listId: a.id },
      body: { thisWeek: true },
    });
    expect(res.body.thisWeek).toBe(true);
    expect((await getList(b.id)).thisWeek).toBe(false);
    const flags = h.table.all().filter((i) => i.sk === 'THISWEEK');
    expect(flags).toHaveLength(1);
    await h.call('PATCH /api/lists/{listId}', {
      path: { listId: a.id },
      body: { thisWeek: false },
    });
    expect(
      (await h.call<ListsResponse>('GET /api/lists')).body.lists.every((l) => !l.thisWeek),
    ).toBe(true);
  });

  it('creates from templates, merging by D-046 and reporting combined lines (D2)', async () => {
    const weekly = await template('Weekly basics', 'weekly', [
      [MILK, 2, 'pack', 'blue top'],
      [BANANAS, 1, 'kg'],
      [BREAD, 1, 'each'],
    ]);
    const tacos = await template('Tacos', 'meal', [
      [MINCE, 1, 'pack'],
      [MILK, 1, 'pack', 'blue top'],
      [BANANAS, 6, 'each'],
    ]);
    const res = await h.call<CreateListResponse>('POST /api/lists', {
      body: { templateIds: [weekly, tacos] },
    });
    expect(res.status).toBe(201);
    expect(res.body.combined).toBe(1);
    const items = res.body.list.items;
    expect(items).toHaveLength(5);
    expect(items.find((i) => i.id === `${MILK}~pack`)).toMatchObject({
      qty: 3,
      note: 'blue top',
      ticked: false,
      product: { name: 'Full Cream Milk 2L', groupId: 'dairy-eggs', packSize: '2 L' },
    });
    expect(
      items
        .filter((i) => i.product.productId === BANANAS)
        .map((i) => i.unit)
        .sort(),
    ).toEqual(['each', 'kg']);
    expect(res.body.list).toMatchObject({ itemCount: 5, tickedCount: 0 });
  });

  it('adds templates to an existing list with the same merge rule and undo info (D3)', async () => {
    const weekly = await template('Weekly', 'weekly', [
      [MILK, 2, 'pack'],
      [BREAD, 1, 'each'],
    ]);
    const list = await newList();
    await add(list.id, MILK, 1, 'pack');
    const res = await h.call<{
      list: ListDetail;
      added: number;
      combined: number;
      changes: unknown[];
    }>('POST /api/lists/{listId}/templates', {
      path: { listId: list.id },
      body: { templateIds: [weekly] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 2, combined: 1 });
    expect(res.body.changes).toEqual(
      expect.arrayContaining([
        { itemId: `${MILK}~pack`, created: false, addedQty: 2, version: 2 },
        { itemId: `${BREAD}~each`, created: true, addedQty: 1, version: 1 },
      ]),
    );
    expect(res.body.list.items.find((i) => i.id === `${MILK}~pack`)?.qty).toBe(3);
  });

  it('rejects unknown templates', async () => {
    const res = await h.call('POST /api/lists', {
      body: { templateIds: ['0b5d6a1e-1f1a-4c1e-9a43-2f6f8f0a7c11'] },
    });
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION', field: 'templateIds' } });
  });

  it('renames with a version check (H3) and deletes with its items (D5)', async () => {
    const list = await newList();
    await add(list.id, MILK, 1, 'pack');
    const ok = await h.call<ListSummary>('PATCH /api/lists/{listId}', {
      path: { listId: list.id },
      body: { name: '  Big  shop ', version: 1 },
    });
    expect(ok.body).toMatchObject({ name: 'Big shop', version: 2 });
    const stale = await h.call('PATCH /api/lists/{listId}', {
      path: { listId: list.id },
      body: { name: 'Again', version: 1 },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { code: 'CONFLICT', reason: 'STALE', current: { name: 'Big shop', version: 2 } },
    });
    expect(
      (await h.call('PATCH /api/lists/{listId}', { path: { listId: list.id }, body: { name: '' } }))
        .body,
    ).toMatchObject({ field: 'name' });

    expect((await h.call('DELETE /api/lists/{listId}', { path: { listId: list.id } })).status).toBe(
      204,
    );
    expect((await h.call('GET /api/lists/{listId}', { path: { listId: list.id } })).status).toBe(
      404,
    );
    expect(h.table.all().filter((i) => String(i.pk).includes(list.id))).toHaveLength(0);
    expect(h.table.all().filter((i) => i.sk === 'THISWEEK')).toHaveLength(0);
  });

  it('limits active lists to 10 (409)', async () => {
    for (let i = 0; i < 10; i += 1) await newList({ name: `L${i}` });
    const res = await h.call('POST /api/lists', { body: {} });
    expect(res).toMatchObject({ status: 409, body: { code: 'CONFLICT', reason: 'LIMIT' } });
    expect(String(res.body.message)).toContain('10 lists');
  });

  it('validates names and ids', async () => {
    expect(
      (await h.call('POST /api/lists', { body: { name: 'x'.repeat(61) } })).body,
    ).toMatchObject({
      code: 'VALIDATION',
      field: 'name',
    });
    expect((await h.call('GET /api/lists/{listId}', { path: { listId: 'LIST#x' } })).status).toBe(
      404,
    );
    expect((await h.call('POST /api/lists', { body: '{bad' })).status).toBe(400);
  });
});

describe('list items', () => {
  it('adds with a server-side snapshot, merges the same unit and keeps others separate (C4, D-046, D-047)', async () => {
    const list = await newList();
    const first = await add(list.id, MILK, 1, 'pack', 'blue top');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      merged: false,
      addedQty: 1,
      item: {
        id: `${MILK}~pack`,
        qty: 1,
        unit: 'pack',
        note: 'blue top',
        ticked: false,
        version: 1,
        product: {
          productId: MILK,
          name: 'Full Cream Milk 2L',
          brand: 'Farmdale',
          imageUrl: `https://img.example/${MILK}.jpg`,
          packSize: '2 L',
          groupId: 'dairy-eggs',
          unitType: 'pack',
        },
      },
      list: { itemCount: 1, tickedCount: 0 },
    });
    const second = await add(list.id, MILK, 2, 'pack', 'skim if none');
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      merged: true,
      addedQty: 2,
      item: { qty: 3, note: 'blue top / skim if none', version: 2 },
    });
    const litres = await add(list.id, MILK, 2, 'L');
    expect(litres.status).toBe(201);
    expect((await getList(list.id)).items).toHaveLength(2);
  });

  it('unticks a ticked row when more of it is added', async () => {
    const list = await newList();
    await add(list.id, BREAD, 1, 'each');
    await add(list.id, MILK, 1, 'pack');
    await tick(list.id, `${BREAD}~each`);
    const res = await add(list.id, BREAD, 1, 'each');
    expect(res.body.item).toMatchObject({ qty: 2, ticked: false, tickedAt: null });
  });

  it('validates products, quantities and notes (A2)', async () => {
    const list = await newList();
    const bad = async (body: Record<string, unknown>) =>
      (await h.call('POST /api/lists/{listId}/items', { path: { listId: list.id }, body })).body;
    expect(await bad({ productId: '999999', qty: 1, unit: 'each' })).toMatchObject({
      field: 'productId',
    });
    expect(
      await bad({ productId: 'custom-11111111-2222-3333-4444-555555555555', qty: 1, unit: 'each' }),
    ).toMatchObject({ field: 'productId' });
    expect(await bad({ productId: MILK, qty: 0, unit: 'pack' })).toMatchObject({ field: 'qty' });
    expect(await bad({ productId: MILK, qty: 1.5, unit: 'pack' })).toMatchObject({ field: 'qty' });
    expect(await bad({ productId: MILK, qty: 1000, unit: 'pack' })).toMatchObject({ field: 'qty' });
    expect(await bad({ productId: MILK, qty: 1, unit: 'tub' })).toMatchObject({ field: 'unit' });
    expect(
      await bad({ productId: MILK, qty: 1, unit: 'pack', note: 'n'.repeat(201) }),
    ).toMatchObject({
      field: 'note',
    });
    await add(list.id, MILK, 990, 'pack');
    expect(await bad({ productId: MILK, qty: 10, unit: 'pack' })).toMatchObject({ field: 'qty' });
    // Discontinued products are still known (history, templates).
    expect((await add(list.id, ICE_CREAM, 1, 'pack')).status).toBe(201);
  });

  it("accepts the household's own custom products", async () => {
    const created = await h.call<{ sku: string }>('POST /api/products/custom', {
      body: { name: 'Farm eggs', unitType: 'each', groupId: 'dairy-eggs' },
    });
    const list = await newList();
    const res = await add(list.id, created.body.sku, 12, 'each');
    expect(res.status).toBe(201);
    expect(res.body.item.product).toMatchObject({
      name: 'Farm eggs',
      imageUrl: null,
      groupId: 'eggs',
    });
  });

  it('limits a list to 200 items (409)', async () => {
    const list = await newList();
    for (let i = 0; i < 200; i += 1) {
      const r = await add(list.id, String(800000 + i), 1, 'each');
      expect(r.status).toBe(201);
    }
    const res = await add(list.id, '800200', 1, 'each');
    expect(res).toMatchObject({ status: 409, body: { reason: 'LIMIT' } });
    expect(String((res.body as unknown as { message: string }).message)).toContain('200 items');
    // Merging into an existing row still works at the limit.
    expect((await add(list.id, '800000', 1, 'each')).status).toBe(200);
  });

  it('edits qty and note with a version check; stale edits get 409 with the latest row (D6, H3)', async () => {
    const list = await newList();
    await add(list.id, BANANAS, 1, 'kg');
    const ok = await h.call<ListItemUpdateResponse>('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BANANAS}~kg` },
      body: { qty: 1.5, note: 'green', version: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.item).toMatchObject({ qty: 1.5, note: 'green', version: 2 });
    const stale = await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BANANAS}~kg` },
      body: { qty: 2, version: 1 },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { reason: 'STALE', current: { qty: 1.5, note: 'green', version: 2 } },
    });
    const missingVersion = await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BANANAS}~kg` },
      body: { qty: 2 },
    });
    expect(missingVersion.body).toMatchObject({ field: 'version' });
    const wrongPrecision = await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BANANAS}~kg` },
      body: { qty: 1.333, version: 2 },
    });
    expect(wrongPrecision.body).toMatchObject({ field: 'qty' });
  });

  it('changes unit by re-keying the row, merging into an existing row with that unit', async () => {
    const list = await newList();
    await add(list.id, BANANAS, 1.5, 'kg', 'ripe');
    await add(list.id, BANANAS, 2, 'each');
    const moved = await h.call<ListItemUpdateResponse>('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BANANAS}~kg` },
      body: { unit: 'g', qty: 1500, version: 1 },
    });
    expect(moved.body).toMatchObject({
      replacedItemId: `${BANANAS}~kg`,
      item: { id: `${BANANAS}~g`, unit: 'g', qty: 1500, note: 'ripe', version: 2 },
    });
    const merged = await h.call<ListItemUpdateResponse>(
      'PATCH /api/lists/{listId}/items/{itemId}',
      {
        path: { listId: list.id, itemId: `${BANANAS}~g` },
        body: { unit: 'each', qty: 4, version: 2 },
      },
    );
    expect(merged.body.item).toMatchObject({ id: `${BANANAS}~each`, qty: 6, note: 'ripe' });
    expect((await getList(list.id)).items.map((i) => i.id)).toEqual([`${BANANAS}~each`]);
  });

  it('deletes an item, optionally version-checked (D7)', async () => {
    const list = await newList();
    await add(list.id, BREAD, 1, 'each');
    await add(list.id, MILK, 1, 'pack');
    const stale = await h.call('DELETE /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BREAD}~each` },
      query: { version: '5' },
    });
    expect(stale).toMatchObject({ status: 409, body: { reason: 'STALE' } });
    const res = await h.call<{ list: ListSummary }>('DELETE /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BREAD}~each` },
    });
    expect(res.status).toBe(200);
    expect(res.body.list.itemCount).toBe(1);
    const again = await h.call('DELETE /api/lists/{listId}/items/{itemId}', {
      path: { listId: list.id, itemId: `${BREAD}~each` },
    });
    expect(again.status).toBe(404);
    // "Undo" re-creates the row: add it back, then restore ticked state with a tick.
    expect((await add(list.id, BREAD, 1, 'each')).status).toBe(201);
  });

  it('returns 404 for malformed item ids and unknown items', async () => {
    const list = await newList();
    expect((await tick(list.id, 'nope')).status).toBe(404);
    expect((await tick(list.id, `${MILK}~pack`)).status).toBe(404);
  });
});

describe('"this week" target (C1, C2, D-048)', () => {
  it('creates and flags "Week of <Monday>" when none is flagged, then reuses it', async () => {
    const first = await h.call<ListItemMutationResponse>('POST /api/this-week/items', {
      body: { productId: BANANAS, qty: 1.5, unit: 'kg' },
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      listCreated: true,
      list: { name: 'Week of 23 Nov', thisWeek: true, itemCount: 1 },
    });
    const second = await h.call<ListItemMutationResponse>('POST /api/this-week/items', {
      body: { productId: BANANAS, qty: 0.5, unit: 'kg' },
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ listCreated: false, merged: true, item: { qty: 2 } });
    expect(second.body.list.id).toBe(first.body.list.id);
  });

  it('uses the flagged list even when other lists exist', async () => {
    await newList({ name: 'Other', thisWeek: false });
    const flagged = await newList({ name: 'This one', thisWeek: true });
    const res = await h.call<ListItemMutationResponse>('POST /api/this-week/items', {
      body: { productId: MILK, qty: 1, unit: 'pack' },
    });
    expect(res.body.list.id).toBe(flagged.id);
  });

  it('two phones adding with no flagged list end up on one list', async () => {
    const [a, b] = await Promise.all([
      h.call<ListItemMutationResponse>('POST /api/this-week/items', {
        body: { productId: MILK, qty: 1, unit: 'pack' },
      }),
      h.call<ListItemMutationResponse>('POST /api/this-week/items', {
        body: { productId: MILK, qty: 1, unit: 'pack' },
        user: 'user-2',
      }),
    ]);
    expect(a.body.list.id).toBe(b.body.list.id);
    const lists = (await h.call<ListsResponse>('GET /api/lists')).body.lists;
    expect(lists).toHaveLength(1);
    expect((await getList(a.body.list.id)).items[0]?.qty).toBe(2);
  });

  it('validates the product before creating a list', async () => {
    const res = await h.call('POST /api/this-week/items', {
      body: { productId: '1', qty: 1, unit: 'each' },
    });
    expect(res.status).toBe(400);
    expect((await h.call<ListsResponse>('GET /api/lists')).body.lists).toHaveLength(0);
  });
});

describe('ticking, auto-archive, undo, finish (F1-F5)', () => {
  async function listWith(n: number) {
    const list = await newList();
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      ids.push((await add(list.id, String(800000 + i), 1, 'each')).body.item.id);
    }
    return { list, ids };
  }

  it('ticks and unticks without a version (idempotent sets)', async () => {
    const { list, ids } = await listWith(2);
    const t1 = await tick(list.id, ids[0]!);
    expect(t1.body).toMatchObject({
      archived: false,
      item: { ticked: true },
      list: { tickedCount: 1 },
    });
    expect(t1.body.item.tickedAt).toBeTruthy();
    const again = await tick(list.id, ids[0]!);
    expect(again.body.list.tickedCount).toBe(1);
    const un = await tick(list.id, ids[0]!, false);
    expect(un.body.item).toMatchObject({ ticked: false, tickedAt: null });
  });

  it('archives on the last tick, writes purchase rows, clears the flag, and Undo reverses it', async () => {
    const { list, ids } = await listWith(3);
    await tick(list.id, ids[0]!);
    await tick(list.id, ids[1]!);
    const last = await tick(list.id, ids[2]!);
    expect(last.body.archived).toBe(true);
    expect(last.body.list).toMatchObject({
      status: 'archived',
      thisWeek: false,
      itemCount: 3,
      tickedCount: 3,
      finishedBy: 'auto',
      completedAt: new Date(Date.parse('2026-11-22T03:00:00.000Z')).toISOString(),
    });
    const purchases = h.table.all().filter((i) => String(i.sk).startsWith('PURCHASE#'));
    expect(purchases.map((p) => p.sk).sort()).toEqual(
      ids.map((id) => `PURCHASE#${id.split('~')[0]}#2026-11-22#${list.id}#each`).sort(),
    );
    expect(purchases[0]).toMatchObject({ pk: 'HH#home-1', qty: 1, unit: 'each', listId: list.id });

    // Read-only once archived (F5).
    expect((await tick(list.id, ids[0]!, false)).body).toMatchObject({ reason: 'LIST_ARCHIVED' });
    expect((await add(list.id, MILK, 1, 'pack')).status).toBe(409);
    expect((await h.call('DELETE /api/lists/{listId}', { path: { listId: list.id } })).status).toBe(
      409,
    );
    expect(
      (
        await h.call('PATCH /api/lists/{listId}', {
          path: { listId: list.id },
          body: { name: 'x', version: 2 },
        })
      ).status,
    ).toBe(409);
    expect((await h.call<ListsResponse>('GET /api/lists')).body.lists).toHaveLength(0);

    h.advance(8000);
    const undo = await h.call<ListArchiveResponse>('POST /api/lists/{listId}/reopen', {
      path: { listId: list.id },
    });
    expect(undo.status).toBe(200);
    expect(undo.body.list).toMatchObject({
      status: 'active',
      completedAt: null,
      thisWeek: true,
      itemCount: 3,
      tickedCount: 3,
    });
    expect(h.table.all().filter((i) => String(i.sk).startsWith('PURCHASE#'))).toHaveLength(0);

    // Does not re-archive until a later tick completes it again (D-049).
    await tick(list.id, ids[0]!, false);
    const done = await tick(list.id, ids[0]!);
    expect(done.body.archived).toBe(true);
    expect(h.table.all().filter((i) => String(i.sk).startsWith('PURCHASE#'))).toHaveLength(3);
  });

  it('refuses Undo after the window and for active lists', async () => {
    const { list, ids } = await listWith(1);
    expect(
      (await h.call('POST /api/lists/{listId}/reopen', { path: { listId: list.id } })).body,
    ).toMatchObject({ reason: 'NOT_ARCHIVED' });
    await tick(list.id, ids[0]!);
    h.advance(3 * 60 * 1000);
    const res = await h.call('POST /api/lists/{listId}/reopen', { path: { listId: list.id } });
    expect(res).toMatchObject({ status: 409, body: { reason: 'UNDO_EXPIRED' } });
  });

  it('"Finish shop" archives with unticked items recorded as not bought (F2)', async () => {
    const { list, ids } = await listWith(3);
    await tick(list.id, ids[0]!);
    const res = await h.call<ListArchiveResponse>('POST /api/lists/{listId}/finish', {
      path: { listId: list.id },
    });
    expect(res.status).toBe(200);
    expect(res.body.list).toMatchObject({
      status: 'archived',
      finishedBy: 'finish',
      itemCount: 3,
      tickedCount: 1,
    });
    expect(res.body.list.items.filter((i) => !i.ticked)).toHaveLength(2);
    const purchases = h.table.all().filter((i) => String(i.sk).startsWith('PURCHASE#'));
    expect(purchases).toHaveLength(1);
    const again = await h.call('POST /api/lists/{listId}/finish', { path: { listId: list.id } });
    expect(again).toMatchObject({ status: 409, body: { reason: 'LIST_ARCHIVED' } });
  });

  it('never auto-archives an empty list; finishing one is allowed', async () => {
    const list = await newList();
    const res = await h.call<ListArchiveResponse>('POST /api/lists/{listId}/finish', {
      path: { listId: list.id },
    });
    expect(res.body.list).toMatchObject({ status: 'archived', itemCount: 0, tickedCount: 0 });
  });

  it('lists history newest first with paging, read-only detail (F5)', async () => {
    const made: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const list = await newList({ name: `Shop ${i}` });
      const r = await add(list.id, MILK, 1, 'pack');
      await add(list.id, BREAD, 1, 'each');
      await tick(list.id, r.body.item.id);
      await h.call('POST /api/lists/{listId}/finish', { path: { listId: list.id } });
      made.push(list.id);
      h.advance(60_000);
    }
    const page1 = await h.call<HistoryResponse>('GET /api/history', { query: { limit: '2' } });
    expect(page1.body.lists.map((l) => l.name)).toEqual(['Shop 2', 'Shop 1']);
    expect(page1.body.lists[0]).toMatchObject({ itemCount: 2, tickedCount: 1, status: 'archived' });
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await h.call<HistoryResponse>('GET /api/history', {
      query: { limit: '2', cursor: page1.body.nextCursor! },
    });
    expect(page2.body.lists.map((l) => l.name)).toEqual(['Shop 0']);
    expect(page2.body.nextCursor).toBeNull();
    const detail = await getList(made[0]!);
    expect(detail.status).toBe('archived');
    expect(detail.items).toHaveLength(2);
    expect((await h.call('GET /api/history', { query: { cursor: 'garbage' } })).status).toBe(400);
    expect((await h.call('GET /api/history', { query: { limit: '0' } })).status).toBe(400);
  });
});
