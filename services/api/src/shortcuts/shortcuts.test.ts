import { describe, expect, it } from 'vitest';
import { keys, type QuickResponse, type ShortcutKey } from '@trolley/core';
import { product, setup, type Harness } from '../test/harness';
import { QUICK_PER_MINUTE, parseQuickBody, splitItems } from './routes';
import { MAX_KEYS_PER_HOUSEHOLD } from './store';

const KLEENEX = '900001';
const ALDI_TISSUES = '900002';
const SORBENT = '900003';
const CHIPS_SALT = '900010';
const CHIPS_BBQ = '900011';
const TRUFFLE = '900012';
const EXTRA = [
  product(KLEENEX, 'Kleenex Tissues', 'household', 'pack', { brand: 'Kleenex' }),
  product(ALDI_TISSUES, 'ALDI Tissues', 'household', 'pack'),
  product(SORBENT, 'Sorbent Tissues', 'household', 'pack'),
  product(CHIPS_SALT, 'Sea Salt Chips', 'snacks', 'pack'),
  product(CHIPS_BBQ, 'BBQ Chips', 'snacks', 'pack'),
  product(TRUFFLE, 'Truffle Crisps', 'snacks', 'pack', { notAtStore: true }),
  product('900040', 'Free Range Eggs 12 pack', 'dairy-eggs', 'pack'),
];

async function bought(h: Harness, hh: string, productId: string, name: string, date: string) {
  const listId = `00000000-0000-4000-8000-${date.replace(/-/g, '').padStart(12, '0')}`;
  await h.db.put({
    pk: keys.householdPk(hh),
    sk: `${keys.purchaseSkPrefix}${productId}#${date}#${listId}#pack`,
    entity: 'Purchase',
    productId,
    name,
    groupId: 'household',
    qty: 1,
    unit: 'pack',
    listId,
    date,
  });
}

async function makeKey(h: Harness, name = "Sam's iPhone", hh = 'home-1', user = 'user-1') {
  const res = await h.call<{ key: string; shortcutKey: ShortcutKey }>('POST /api/shortcut-keys', {
    hh,
    user,
    body: { name },
  });
  return res;
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function add(h: Harness, key: string, body: unknown, rawBody?: string) {
  return h.call<QuickResponse>('POST /api/quick/add', {
    hh: null,
    headers: bearer(key),
    ...(rawBody !== undefined ? { rawBody } : { body }),
  });
}

async function ready(hh = 'home-1') {
  const h = setup({ extraProducts: EXTRA });
  const { body } = await makeKey(h, "Sam's iPhone", hh);
  return { h, key: body.key };
}

describe('shortcut keys (create, list, revoke)', () => {
  it('creates a key shown once, stored only as a SHA-256 hash', async () => {
    const h = setup();
    const res = await makeKey(h);
    expect(res.status).toBe(201);
    const { key, shortcutKey } = res.body;
    expect(key).toMatch(/^trl_[A-Za-z0-9_-]{43,}$/);
    expect(shortcutKey).toMatchObject({ name: "Sam's iPhone", lastUsedAt: null });

    const list = await h.call<{ keys: ShortcutKey[]; max: number }>('GET /api/shortcut-keys');
    expect(list.body.max).toBe(MAX_KEYS_PER_HOUSEHOLD);
    expect(list.body.keys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body.keys[0]).toMatchObject({ name: "Sam's iPhone", createdBy: 'a' });
    expect(list.body.keys[0]).not.toHaveProperty('hash');

    // The raw key appears in no stored row; only its hash does.
    const rows = JSON.stringify(h.table.all());
    expect(rows).not.toContain(key);
    expect(rows).toContain('SHORTKEY#');
  });

  it('validates the name and caps keys at 5 per household', async () => {
    const h = setup();
    expect((await makeKey(h, '   ')).status).toBe(400);
    expect((await makeKey(h, 'x'.repeat(41))).status).toBe(400);
    for (let i = 0; i < MAX_KEYS_PER_HOUSEHOLD; i++) {
      expect((await makeKey(h, `Phone ${i}`)).status).toBe(201);
    }
    const sixth = await makeKey(h, 'One too many');
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({ reason: 'LIMIT' });
    // Another household is unaffected.
    expect((await makeKey(h, 'Other', 'home-2')).status).toBe(201);
  });

  it('requires sign-in, and revoke removes the key (404 the second time)', async () => {
    const { h, key } = await ready();
    expect((await h.call('GET /api/shortcut-keys', { hh: null })).status).toBe(401);
    const list = await h.call<{ keys: ShortcutKey[] }>('GET /api/shortcut-keys');
    const id = list.body.keys[0]?.keyId ?? '';
    expect((await add(h, key, { text: 'eggs' })).status).toBe(200);
    expect(
      (await h.call('DELETE /api/shortcut-keys/{keyId}', { path: { keyId: id } })).status,
    ).toBe(204);
    expect(
      (await h.call('DELETE /api/shortcut-keys/{keyId}', { path: { keyId: id } })).status,
    ).toBe(404);
    const after = await add(h, key, { text: 'eggs' });
    expect(after.status).toBe(401);
    expect(after.body.spoken).toBe("That Trolley key isn't valid any more.");
  });

  it("cannot revoke or see another household's keys", async () => {
    const { h, key } = await ready('home-1');
    const id = (await h.call<{ keys: ShortcutKey[] }>('GET /api/shortcut-keys')).body.keys[0]
      ?.keyId;
    expect(
      (
        await h.call('DELETE /api/shortcut-keys/{keyId}', {
          hh: 'home-2',
          path: { keyId: id ?? '' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.call<{ keys: ShortcutKey[] }>('GET /api/shortcut-keys', { hh: 'home-2' })).body.keys,
    ).toEqual([]);
    expect((await add(h, key, { text: 'eggs' })).status).toBe(200);
  });
});

describe('POST /api/quick/add', () => {
  it('rejects a missing, malformed, unknown or wrong-format key with the spoken 401', async () => {
    const { h } = await ready();
    for (const headers of [
      {},
      { authorization: 'Bearer' },
      { authorization: 'Bearer nope' },
      { authorization: `Bearer trl_${'a'.repeat(43)}` },
      { authorization: `Basic trl_${'a'.repeat(43)}` },
    ] as Array<Record<string, string>>) {
      const r = await h.call<QuickResponse>('POST /api/quick/add', {
        hh: null,
        headers,
        body: { text: 'eggs' },
      });
      expect(r.status).toBe(401);
      expect(r.body.spoken).toBe("That Trolley key isn't valid any more.");
    }
    // A Cognito-style token never works here.
    expect((await h.call('POST /api/quick/add', { body: { text: 'eggs' } })).status).toBe(401);
  });

  it('adds the usual product from history and merges on a repeat', async () => {
    const { h, key } = await ready();
    await bought(h, 'home-1', KLEENEX, 'Kleenex Tissues', '2026-09-01');
    await bought(h, 'home-1', KLEENEX, 'Kleenex Tissues', '2026-10-01');
    const r = await add(h, key, { text: 'tissues' });
    expect(r.status).toBe(200);
    expect(r.body.spoken).toBe('Added Kleenex Tissues to Week of 23 Nov.');
    expect(r.body.added).toEqual([{ name: 'Kleenex Tissues', qty: 1, unit: 'pack' }]);
    await add(h, key, { text: 'tissues', quantity: 2 });
    const lists = await h.call<{ lists: Array<{ id: string; thisWeek: boolean }> }>(
      'GET /api/lists',
    );
    expect(lists.body.lists.filter((l) => l.thisWeek)).toHaveLength(1);
    const detail = await h.call<{ items: Array<{ qty: number }> }>('GET /api/lists/{listId}', {
      path: { listId: lists.body.lists.find((l) => l.thisWeek)?.id ?? '' },
    });
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]?.qty).toBe(3);
  });

  it('ambiguous with no history adds nothing and names up to three options', async () => {
    const { h, key } = await ready();
    const r = await add(h, key, { text: 'tissues' });
    expect(r.status).toBe(200);
    expect(r.body.added).toBeUndefined();
    expect(r.body.spoken).toMatch(/^I found a few - .+, .+ or .+\. Try saying the one you want\.$/);
    expect(r.body.spoken).toMatch(/Kleenex Tissues|ALDI Tissues|Sorbent Tissues/);
    const lists = await h.call<{ lists: unknown[] }>('GET /api/lists');
    expect(lists.body.lists).toHaveLength(0);
  });

  it('says so when nothing matches, and skips products not at the store', async () => {
    const { h, key } = await ready();
    const none = await add(h, key, { text: 'zzqx widgets' });
    expect(none.body.spoken).toBe("I couldn't find zzqx widgets at ALDI.");
    const off = await add(h, key, { text: 'truffle crisps' });
    expect(off.body.spoken).toBe("I couldn't find truffle crisps at ALDI.");
  });

  it('adds several "and"-separated items with one combined sentence', async () => {
    const { h, key } = await ready();
    const r = await add(h, key, { text: 'milk and eggs' });
    expect(r.body.spoken).toBe(
      'Added Full Cream Milk 2L and Free Range Eggs 12 pack to Week of 23 Nov.',
    );
    expect(r.body.added).toHaveLength(2);
    const mixed = await add(h, key, { text: 'bread, tissues and zzqx' });
    expect(mixed.body.spoken).toMatch(
      /^Added Wholemeal Bread to Week of 23 Nov\. For tissues, I found a few - /,
    );
    expect(mixed.body.spoken).toMatch(/I couldn't find zzqx at ALDI\.$/);
  });

  it('accepts a plain-text body, and a JSON string', async () => {
    const { h, key } = await ready();
    expect((await add(h, key, null, 'bananas')).body.spoken).toBe(
      'Added Cavendish Bananas to Week of 23 Nov.',
    );
    expect((await add(h, key, null, '"bread"')).body.spoken).toContain('Wholemeal Bread');
  });

  it('asks again when there is nothing to add', async () => {
    const { h, key } = await ready();
    for (const raw of ['', '   ', '{}', '{"text":""}', '{"text":5}']) {
      const r = await add(h, key, null, raw);
      expect(r.status).toBe(400);
      expect(r.body.spoken).toMatch(/didn't catch/);
    }
  });

  it('keeps households apart: a key only touches its own household', async () => {
    const h = setup({ extraProducts: EXTRA });
    const a = (await makeKey(h, 'A', 'home-1')).body.key;
    const b = (await makeKey(h, 'B', 'home-2')).body.key;
    await add(h, a, { text: 'milk' });
    const listFor = async (key: string) =>
      (await h.call<QuickResponse>('GET /api/quick/list', { hh: null, headers: bearer(key) })).body
        .spoken;
    expect(await listFor(a)).toBe("You've got 1 thing left: Full Cream Milk 2L.");
    expect(await listFor(b)).toBe("There's no list for this week yet.");
    const home2 = await h.call<{ lists: unknown[] }>('GET /api/lists', { hh: 'home-2' });
    expect(home2.body.lists).toHaveLength(0);
  });

  it('rate-limits each key to 30 a minute, then recovers', async () => {
    const { h, key } = await ready();
    for (let i = 0; i < QUICK_PER_MINUTE; i++) {
      expect((await add(h, key, { text: 'milk' })).status).toBe(200);
    }
    const over = await add(h, key, { text: 'milk' });
    expect(over.status).toBe(429);
    expect(over.body.spoken).toMatch(/a lot at once/);
    expect(over.headers['retry-after']).toBe('60');
    h.advance(61_000);
    expect((await add(h, key, { text: 'milk' })).status).toBe(200);
    // Another key is not affected.
    const other = (await makeKey(h, 'Other')).body.key;
    expect((await add(h, other, { text: 'milk' })).status).toBe(200);
  });

  it('records last used (at most every 15 minutes) and logs no key or text', async () => {
    const { h, key } = await ready();
    await add(h, key, { text: 'secret milk' });
    const first = (await h.call<{ keys: ShortcutKey[] }>('GET /api/shortcut-keys')).body.keys[0];
    expect(first?.lastUsedAt).toBe(new Date(Date.parse('2026-11-22T03:00:00.000Z')).toISOString());
    h.advance(5 * 60_000);
    await add(h, key, { text: 'milk' });
    expect(
      (await h.call<{ keys: ShortcutKey[] }>('GET /api/shortcut-keys')).body.keys[0]?.lastUsedAt,
    ).toBe(first?.lastUsedAt);
    const logs = JSON.stringify(h.logs);
    expect(logs).not.toContain(key);
    expect(logs).not.toContain('secret');
  });
});

describe('GET /api/quick/list', () => {
  it('lists unticked items only, capped at 20 names', async () => {
    const { h, key } = await ready();
    const get = async () =>
      (await h.call<QuickResponse>('GET /api/quick/list', { hh: null, headers: bearer(key) })).body
        .spoken;
    expect(await get()).toBe("There's no list for this week yet.");
    await add(h, key, { text: 'milk and eggs and bananas' });
    const lists = await h.call<{ lists: Array<{ id: string; thisWeek: boolean }> }>(
      'GET /api/lists',
    );
    const id = lists.body.lists.find((l) => l.thisWeek)?.id ?? '';
    const detail = await h.call<{ items: Array<{ id: string; product: { name: string } }> }>(
      'GET /api/lists/{listId}',
      { path: { listId: id } },
    );
    const milk = detail.body.items.find((i) => i.product.name.includes('Milk'));
    await h.call('PATCH /api/lists/{listId}/items/{itemId}', {
      path: { listId: id, itemId: milk?.id ?? '' },
      body: { ticked: true },
    });
    const spoken = await get();
    expect(spoken).toMatch(/^You've got 2 things left: .+ and .+\.$/);
    expect(spoken).not.toContain('Milk');
    expect((await h.call('GET /api/quick/list', { hh: null })).status).toBe(401);
  });
});

describe('parsing helpers', () => {
  it('splits on and, commas and ampersands, and parses bodies', () => {
    expect(splitItems('milk and eggs')).toEqual(['milk', 'eggs']);
    expect(splitItems('Milk, eggs & bread')).toEqual(['Milk', 'eggs', 'bread']);
    expect(splitItems('sandwich')).toEqual(['sandwich']);
    expect(parseQuickBody({ body: '{"text":"milk","quantity":2}' })).toEqual({
      text: 'milk',
      quantity: 2,
    });
    expect(
      parseQuickBody({
        body: Buffer.from('{"text":"milk"}').toString('base64'),
        isBase64Encoded: true,
      }),
    ).toEqual({ text: 'milk' });
    expect(parseQuickBody({ body: '{not json' })).toEqual({ text: '{not json' });
  });
});
