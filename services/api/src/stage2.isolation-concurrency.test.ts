/**
 * A1 household isolation (two households, guessed ids, ignored householdId in bodies) and
 * H2/H3/F3 concurrency against the in-memory DynamoDB with interleaved requests.
 */
import type {
  CreateListResponse,
  HistoryResponse,
  ListDetail,
  ListItemMutationResponse,
  ListItemUpdateResponse,
  ListsResponse,
  Template,
  TemplatesResponse,
  UnitOverridesResponse,
} from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BREAD, MILK, setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

describe('household isolation (A1)', () => {
  it('another household gets 404 for every list, item, template and settings route', async () => {
    const list = (
      await h.call<CreateListResponse>('POST /api/lists', { body: { householdId: 'home-2' } })
    ).body.list;
    await h.call('POST /api/lists/{listId}/items', {
      path: { listId: list.id },
      body: { productId: MILK, qty: 1, unit: 'pack', householdId: 'home-2' },
    });
    const tpl = (
      await h.call<Template>('POST /api/templates', {
        body: { name: 'Weekly', householdId: 'home-2' },
      })
    ).body;
    await h.call('POST /api/templates/{templateId}/items', {
      path: { templateId: tpl.id },
      body: { productId: MILK, qty: 1, unit: 'pack' },
    });
    await h.call('PUT /api/settings/unit-overrides/{productId}', {
      path: { productId: MILK },
      body: { unit: 'L' },
    });

    // Everything was written under home-1 despite householdId in the bodies.
    expect(h.table.all().some((i) => String(i.pk).includes('home-2'))).toBe(false);

    const other = { hh: 'home-2', user: 'intruder' };
    const listId = list.id;
    const itemId = `${MILK}~pack`;
    const templateId = tpl.id;
    const attempts: Array<[string, Record<string, unknown>]> = [
      ['GET /api/lists/{listId}', { path: { listId } }],
      ['PATCH /api/lists/{listId}', { path: { listId }, body: { name: 'x', version: 1 } }],
      ['PATCH /api/lists/{listId}', { path: { listId }, body: { thisWeek: true } }],
      ['DELETE /api/lists/{listId}', { path: { listId } }],
      [
        'POST /api/lists/{listId}/items',
        { path: { listId }, body: { productId: BREAD, qty: 1, unit: 'each' } },
      ],
      [
        'PATCH /api/lists/{listId}/items/{itemId}',
        { path: { listId, itemId }, body: { ticked: true } },
      ],
      [
        'PATCH /api/lists/{listId}/items/{itemId}',
        { path: { listId, itemId }, body: { qty: 5, version: 1 } },
      ],
      ['DELETE /api/lists/{listId}/items/{itemId}', { path: { listId, itemId } }],
      [
        'POST /api/lists/{listId}/templates',
        { path: { listId }, body: { templateIds: [templateId] } },
      ],
      ['POST /api/lists/{listId}/finish', { path: { listId } }],
      ['POST /api/lists/{listId}/reopen', { path: { listId } }],
      ['GET /api/templates/{templateId}', { path: { templateId } }],
      [
        'PATCH /api/templates/{templateId}',
        { path: { templateId }, body: { name: 'x', version: 1 } },
      ],
      ['DELETE /api/templates/{templateId}', { path: { templateId } }],
      [
        'POST /api/templates/{templateId}/items',
        { path: { templateId }, body: { productId: BREAD, qty: 1, unit: 'each' } },
      ],
      [
        'PATCH /api/templates/{templateId}/items/{itemId}',
        { path: { templateId, itemId }, body: { qty: 2, version: 1 } },
      ],
      ['DELETE /api/templates/{templateId}/items/{itemId}', { path: { templateId, itemId } }],
      ['DELETE /api/settings/unit-overrides/{productId}', { path: { productId: MILK } }],
    ];
    for (const [route, opts] of attempts) {
      const res = await h.call(route, { ...opts, ...other });
      expect([route, res.status]).toEqual([route, 404]);
    }
    // Creating from another household's template is a validation error, not a leak.
    const fromTpl = await h.call('POST /api/lists', {
      body: { templateIds: [templateId] },
      ...other,
    });
    expect(fromTpl.status).toBe(400);

    // Collections are empty for the other household.
    expect((await h.call<ListsResponse>('GET /api/lists', other)).body.lists).toEqual([]);
    expect((await h.call<HistoryResponse>('GET /api/history', other)).body.lists).toEqual([]);
    expect((await h.call<TemplatesResponse>('GET /api/templates', other)).body.templates).toEqual(
      [],
    );
    expect(
      (await h.call<UnitOverridesResponse>('GET /api/settings/unit-overrides', other)).body
        .overrides,
    ).toEqual([]);

    // Home-1 is untouched.
    const mine = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body;
    expect(mine).toMatchObject({ status: 'active', name: list.name, itemCount: 1, tickedCount: 0 });
    expect(mine.items[0]?.qty).toBe(1);
  });

  it("does not accept another household's history cursor", async () => {
    const list = (await h.call<CreateListResponse>('POST /api/lists', { body: {} })).body.list;
    await h.call('POST /api/lists/{listId}/finish', { path: { listId: list.id } });
    const list2 = (await h.call<CreateListResponse>('POST /api/lists', { body: {} })).body.list;
    await h.call('POST /api/lists/{listId}/finish', { path: { listId: list2.id } });
    const page = await h.call<HistoryResponse>('GET /api/history', { query: { limit: '1' } });
    const res = await h.call('GET /api/history', {
      query: { cursor: page.body.nextCursor! },
      hh: 'home-2',
    });
    expect(res.status).toBe(400);
  });

  it("cannot add another household's custom product", async () => {
    const custom = await h.call<{ sku: string }>('POST /api/products/custom', {
      body: { name: 'Secret sauce' },
    });
    const list = (await h.call<CreateListResponse>('POST /api/lists', { body: {}, hh: 'home-2' }))
      .body.list;
    const res = await h.call('POST /api/lists/{listId}/items', {
      path: { listId: list.id },
      body: { productId: custom.body.sku, qty: 1, unit: 'each' },
      hh: 'home-2',
    });
    expect(res).toMatchObject({ status: 400, body: { field: 'productId' } });
  });

  it('needs a token and a household', async () => {
    expect((await h.call('GET /api/lists', { hh: null })).status).toBe(401);
  });
});

describe('concurrency (H2, H3, C4, F3)', () => {
  async function listWith(n: number) {
    const list = (await h.call<CreateListResponse>('POST /api/lists', { body: {} })).body.list;
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const r = await h.call<ListItemMutationResponse>('POST /api/lists/{listId}/items', {
        path: { listId: list.id },
        body: { productId: String(800000 + i), qty: 1, unit: 'each' },
      });
      ids.push(r.body.item.id);
    }
    return { listId: list.id, ids };
  }

  const tick = (listId: string, itemId: string, ticked: boolean, user = 'user-1') =>
    h.call<ListItemUpdateResponse>('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId, itemId },
      body: { ticked },
      user,
    });

  it('two phones ticking different items concurrently lose neither tick', async () => {
    const { listId, ids } = await listWith(4);
    const [a, b] = await Promise.all([
      tick(listId, ids[0]!, true),
      tick(listId, ids[1]!, true, 'user-2'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const detail = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body;
    expect(
      detail.items
        .filter((i) => i.ticked)
        .map((i) => i.id)
        .sort(),
    ).toEqual([ids[0], ids[1]].sort());
  });

  it('50 interleaved ticks and unticks end in the expected state', async () => {
    const { listId, ids } = await listWith(12);
    const expected = new Map(ids.map((id) => [id, false]));
    const ops: Array<[string, boolean]> = [];
    for (let i = 0; i < 50; i += 1) {
      const id = ids[i % 10]!; // items 10 and 11 stay unticked so the list never completes
      const value = Math.floor(i / 10) % 2 === 0;
      ops.push([id, value]);
    }
    // Two phones; each phone's own requests are sequential, the phones interleave.
    const byItem = new Map<string, Array<[string, boolean]>>();
    for (const op of ops) byItem.set(op[0], [...(byItem.get(op[0]) ?? []), op]);
    for (const [id, list] of byItem) expected.set(id, list.at(-1)![1]);
    await Promise.all(
      [...byItem.values()].map(async (seq) => {
        for (const [id, value] of seq) {
          const r = await tick(listId, id, value, Math.random() < 0.5 ? 'user-1' : 'user-2');
          expect(r.status).toBe(200);
        }
      }),
    );
    const detail = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body;
    expect(detail.status).toBe('active');
    for (const item of detail.items)
      expect([item.id, item.ticked]).toEqual([item.id, expected.get(item.id)]);
  });

  it('stale content edits get 409 and keep the other phone change (H3)', async () => {
    const { listId, ids } = await listWith(1);
    const edit = (qty: number, user: string) =>
      h.call('PATCH /api/lists/{listId}/items/{itemId}', {
        path: { listId, itemId: ids[0]! },
        body: { qty, version: 1 },
        user,
      });
    const results = await Promise.all([edit(3, 'user-1'), edit(5, 'user-2')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body).toMatchObject({ reason: 'STALE', current: { version: 2 } });
    const item = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body
      .items[0];
    expect(item?.qty).toBe((winner.body as { item: { qty: number } }).item.qty);
  });

  it('two phones adding the same product at once merge into one row (C4)', async () => {
    const { listId } = await listWith(0);
    const addMilk = (qty: number, user: string) =>
      h.call<ListItemMutationResponse>('POST /api/lists/{listId}/items', {
        path: { listId },
        body: { productId: MILK, qty, unit: 'pack' },
        user,
      });
    const results = await Promise.all([
      addMilk(1, 'user-1'),
      addMilk(2, 'user-2'),
      addMilk(3, 'user-1'),
    ]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const items = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } })).body
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]?.qty).toBe(6);
  });

  it('ticking the last two items at the same moment archives exactly once (F3, F4)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const { listId, ids } = await listWith(3);
      await tick(listId, ids[0]!, true);
      const [a, b] = await Promise.all([
        tick(listId, ids[1]!, true),
        tick(listId, ids[2]!, true, 'user-2'),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect([a.body.archived, b.body.archived].filter(Boolean)).toHaveLength(1);
      // The phone that lost the race sees the archived state.
      expect(a.body.list.status === 'archived' || b.body.list.status === 'archived').toBe(true);
      const purchases = h.table.all().filter((i) => String(i.sk).includes(`#${listId}#`));
      expect(purchases).toHaveLength(3);
      const detail = (await h.call<ListDetail>('GET /api/lists/{listId}', { path: { listId } }))
        .body;
      expect(detail).toMatchObject({ status: 'archived', version: 2 });
    }
  });
});

describe('access patterns', () => {
  it('never scans: every read is a Get or a Query', async () => {
    const list = (await h.call<CreateListResponse>('POST /api/lists', { body: {} })).body.list;
    await h.call('POST /api/lists/{listId}/items', {
      path: { listId: list.id },
      body: { productId: MILK, qty: 1, unit: 'pack' },
    });
    await h.call('GET /api/lists');
    await h.call('GET /api/history');
    await h.call('GET /api/templates');
    expect(h.table.log.some((c) => /Scan/.test(c))).toBe(false);
  });
});

describe('performance (J3)', () => {
  it('loads a 200-item list with p95 under 500 ms (local, in-memory table)', async () => {
    const tpl = async (offset: number) => {
      const t = (await h.call<Template>('POST /api/templates', { body: { name: `T${offset}` } }))
        .body;
      for (let i = 0; i < 100; i += 1) {
        await h.call('POST /api/templates/{templateId}/items', {
          path: { templateId: t.id },
          body: { productId: String(800000 + offset + i), qty: 1, unit: 'each' },
        });
      }
      return t.id;
    };
    const ids = [await tpl(0), await tpl(100)];
    const list = (
      await h.call<CreateListResponse>('POST /api/lists', { body: { templateIds: ids } })
    ).body.list;
    expect(list.itemCount).toBe(200);
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const res = await h.call<ListDetail>('GET /api/lists/{listId}', {
        path: { listId: list.id },
      });
      times.push(performance.now() - start);
      expect(res.body.items).toHaveLength(200);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(500);
  });
});
