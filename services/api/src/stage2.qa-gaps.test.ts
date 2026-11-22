/**
 * Stage 2 QA gap tests: the id-less routes (this-week, aisle order, history, finish/reopen
 * purchase rows) never cross households, and every Stage 2 route 401s without a token.
 */
import type {
  AisleOrderResponse,
  CreateListResponse,
  HistoryResponse,
  ListDetail,
  ListsResponse,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BREAD, MILK, setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

const other = { hh: 'home-2', user: 'intruder' };

describe('QA: id-less routes are household-scoped', () => {
  it('this-week, aisle order, history and purchase rows stay inside one household', async () => {
    const add = await h.call('POST /api/this-week/items', {
      body: { productId: MILK, qty: 1, unit: 'pack' },
    });
    expect(add.status).toBeLessThan(300);
    const order = (
      await h.call<AisleOrderResponse>('GET /api/settings/aisle-order')
    ).body.groups.map((g) => g.id);
    const reversed = [...order].reverse();
    expect(
      (await h.call('PUT /api/settings/aisle-order', { body: { order: reversed, version: 0 } }))
        .status,
    ).toBeLessThan(300);

    const lists = (await h.call<ListsResponse>('GET /api/lists')).body.lists;
    const id = lists[0]!.id;
    const detail = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId: id } }))
      .body;
    const itemId = detail.items[0]!.id;
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: id, itemId },
      body: { ticked: true },
    });

    // Household 2 sees nothing of it.
    expect((await h.call<ListsResponse>('GET /api/lists', other)).body.lists).toEqual([]);
    expect((await h.call<HistoryResponse>('GET /api/history', other)).body.lists).toEqual([]);
    const o2 = (await h.call<AisleOrderResponse>('GET /api/settings/aisle-order', other)).body;
    expect(o2.isDefault).toBe(true);
    // Its own this-week write makes its own list, not touching household 1's.
    const own = await h.call('POST /api/this-week/items', {
      ...other,
      body: { productId: BREAD, qty: 1, unit: 'each' },
    });
    expect(own.status).toBeLessThan(300);
    // The only item was ticked, so household 1's list auto-archived: it shows in its own History only.
    const hist1 = (await h.call<HistoryResponse>('GET /api/history')).body.lists;
    expect(hist1.map((l) => l.id)).toEqual([id]);
    expect((await h.call<HistoryResponse>('GET /api/history', other)).body.lists).toEqual([]);
    expect(
      h.table
        .all()
        .filter((i) => String(i.pk).includes('home-1') && String(i.sk).startsWith('PURCHASE#')),
    ).toHaveLength(1);
    // Household 2 cannot finish or reopen household 1's list, and no purchase row leaks.
    expect(
      (await h.call('POST /api/lists/{listId}/finish', { ...other, path: { listId: id } })).status,
    ).toBe(404);
    expect(
      (await h.call('POST /api/lists/{listId}/reopen', { ...other, path: { listId: id } })).status,
    ).toBe(404);
    expect(
      h.table
        .all()
        .filter((i) => String(i.pk).includes('home-2') && String(i.sk).startsWith('PURCHASE#')),
    ).toHaveLength(0);
  });

  it('every Stage 2 route answers 401 without a token', async () => {
    const routes = [
      'GET /api/templates',
      'POST /api/templates',
      'GET /api/templates/{templateId}',
      'PATCH /api/templates/{templateId}',
      'DELETE /api/templates/{templateId}',
      'POST /api/templates/{templateId}/items',
      'PATCH /api/templates/{templateId}/items/{itemId}',
      'DELETE /api/templates/{templateId}/items/{itemId}',
      'GET /api/lists',
      'POST /api/lists',
      'GET /api/lists/{listId}',
      'PATCH /api/lists/{listId}',
      'DELETE /api/lists/{listId}',
      'POST /api/lists/{listId}/templates',
      'POST /api/lists/{listId}/items',
      'PATCH /api/lists/{listId}/items/{itemId}',
      'DELETE /api/lists/{listId}/items/{itemId}',
      'POST /api/lists/{listId}/finish',
      'POST /api/lists/{listId}/reopen',
      'GET /api/history',
      'POST /api/this-week/items',
      'GET /api/settings/aisle-order',
      'PUT /api/settings/aisle-order',
      'DELETE /api/settings/aisle-order',
      'GET /api/settings/unit-overrides',
      'PUT /api/settings/unit-overrides/{productId}',
      'DELETE /api/settings/unit-overrides/{productId}',
    ];
    for (const r of routes) {
      const res = await h.call(r, {
        hh: null,
        path: { templateId: 'a', itemId: 'b', listId: 'c', productId: MILK },
        body: {},
      });
      expect([r, res.status]).toEqual([r, 401]);
    }
  });

  it('finish with unticked items writes purchase rows only for ticked; reopen deletes; refinish does not duplicate', async () => {
    const created = (await h.call<CreateListResponse>('POST /api/lists', { body: { name: 'T' } }))
      .body;
    const id = created.list.id;
    for (const [p, u] of [
      [MILK, 'pack'],
      [BREAD, 'each'],
    ]) {
      await h.call('POST /api/lists/{listId}/items', {
        path: { listId: id },
        body: { productId: p, qty: 2, unit: u },
      });
    }
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: id, itemId: `${MILK}~pack` },
      body: { ticked: true },
    });
    const rows = () => h.table.all().filter((i) => String(i.sk).startsWith('PURCHASE#'));
    expect((await h.call('POST /api/lists/{listId}/finish', { path: { listId: id } })).status).toBe(
      200,
    );
    expect(rows()).toHaveLength(1);
    expect((await h.call('POST /api/lists/{listId}/reopen', { path: { listId: id } })).status).toBe(
      200,
    );
    expect(rows()).toHaveLength(0);
    await h.call('POST /api/lists/{listId}/finish', { path: { listId: id } });
    expect(rows()).toHaveLength(1);
    const w = await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: id, itemId: `${MILK}~pack` },
      body: { ticked: false },
    });
    expect(w.status).toBe(409);
  });
});
