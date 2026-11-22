import type {
  BulkAddItemsResponse,
  BulkUndoResponse,
  CreateListResponse,
  ListDetail,
  SuggestionsResponse,
} from '@trolley/core';
import { COLD_START_NOTE } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, resetMockApi } from './mock';
import { MOCK_SEED_IDS } from './mock-stage2';

const claims = { sub: 'user-1', email: 'a@example.com', 'custom:householdId': 'home-1' };
const token = (c: Record<string, string>) =>
  `Bearer mock.${btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const promise = mockFetch(`/api${path}`, {
    method,
    headers: { authorization: token(claims) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  await vi.runAllTimersAsync();
  const res = await promise;
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

const g = globalThis as { __mockSuggest?: unknown; __mockApiFail?: unknown };
const MILK = '000000000000398689';
const BIG_DOG_FOOD = '000000000000398755';
const KIWI = '000000000000380078';
const RAZORS = '000000000000399547';

beforeEach(() => {
  vi.useFakeTimers();
  resetMockApi();
  g.__mockSuggest = null;
  g.__mockApiFail = null;
});

afterEach(() => {
  g.__mockSuggest = null;
  g.__mockApiFail = null;
});

async function newList(): Promise<string> {
  return (await call<CreateListResponse>('POST', '/lists', { thisWeek: false })).body.list.id;
}

describe('mock Stage 3 suggestions', () => {
  it('suggests the weekly template plus due periodic items for a new list, source ai', async () => {
    const id = await newList();
    const res = await call<SuggestionsResponse>('POST', `/lists/${id}/suggestions`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'ai', coldStart: false, note: null });
    const s = res.body.suggestions;
    expect(s.filter((x) => x.fromTemplate)).toHaveLength(10);
    expect(s.slice(0, 10).every((x) => x.fromTemplate)).toBe(true);
    const periodic = s.filter((x) => !x.fromTemplate);
    expect(periodic.map((x) => [x.productId, x.reason])).toEqual([
      [BIG_DOG_FOOD, 'Usually every ~2 weeks, last bought 20 days ago'],
      [KIWI, 'Usually every ~2 weeks, last bought 20 days ago'],
      [RAZORS, 'Usually every ~4 weeks, last bought 34 days ago'],
    ]);
    expect(periodic[0]?.snapshot.name).toMatch(/Dog Food/);
    const milk = s.find((x) => x.productId === MILK);
    expect(milk).toMatchObject({ fromTemplate: true, fromHistory: true, qty: 2, note: 'Blue top' });
    expect(milk?.reason).toBe(
      'On your weekly template - usually every ~7 days, last bought 6 days ago',
    );
  });

  it('excludes what is already on the seeded this-week list', async () => {
    const res = await call<SuggestionsResponse>(
      'POST',
      `/lists/${MOCK_SEED_IDS.thisWeekList}/suggestions`,
    );
    expect(res.body.suggestions.map((x) => x.productId)).toEqual([BIG_DOG_FOOD, KIWI, RAZORS]);
  });

  it('seams: rules, cold start, empty and 429', async () => {
    const id = await newList();
    g.__mockSuggest = { mode: 'rules' };
    expect((await call<SuggestionsResponse>('POST', '/suggestions')).body.source).toBe('rules');
    g.__mockSuggest = { mode: 'coldStart' };
    const cold = (await call<SuggestionsResponse>('POST', `/lists/${id}/suggestions`)).body;
    expect(cold).toMatchObject({ source: 'rules', coldStart: true, note: COLD_START_NOTE });
    expect(cold.suggestions).toHaveLength(10);
    g.__mockSuggest = { mode: 'empty' };
    expect((await call<SuggestionsResponse>('POST', '/suggestions')).body.suggestions).toEqual([]);
    g.__mockSuggest = { mode: 'limit' };
    const limited = await call('POST', `/lists/${id}/suggestions`);
    expect(limited).toEqual({
      status: 429,
      body: {
        code: 'RATE_LIMITED',
        message: "You've used today's suggestions - try again tomorrow.",
      },
    });
  });

  it('counts 20 runs a day, then 429', async () => {
    for (let i = 0; i < 20; i += 1) expect((await call('POST', '/suggestions')).status).toBe(200);
    expect((await call('POST', '/suggestions')).status).toBe(429);
  });

  it('__mockApiFail works on suggestions', async () => {
    g.__mockApiFail = { match: 'POST /api/suggestions', status: 500 };
    expect((await call('POST', '/suggestions')).status).toBe(500);
    expect((await call('POST', '/suggestions')).status).toBe(200);
  });

  it('404 for an unknown list, 409 for an archived one', async () => {
    expect((await call('POST', '/lists/nope/suggestions')).status).toBe(404);
    const archived = MOCK_SEED_IDS.archivedLists[0] as string;
    expect((await call('POST', `/lists/${archived}/suggestions`)).status).toBe(409);
  });
});

describe('mock bulk add', () => {
  it('adds and merges with per-item results, reports failures, and Undo restores', async () => {
    const id = MOCK_SEED_IDS.thisWeekList;
    const before = (await call<ListDetail>('GET', `/lists/${id}`)).body;
    const milkBefore = before.items.find((i) => i.id === `${MILK}~pack`);
    const res = await call<BulkAddItemsResponse>('POST', `/lists/${id}/items/bulk`, {
      items: [
        { productId: RAZORS, qty: 1, unit: 'pack' },
        { productId: MILK, qty: 1, unit: 'pack' },
        { productId: '999999', qty: 1, unit: 'pack' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 2, failed: 1 });
    expect(res.body.results[0]).toMatchObject({
      ok: true,
      change: { itemId: `${RAZORS}~pack`, created: true, addedQty: 1, version: 1 },
    });
    expect(res.body.results[1]).toMatchObject({
      ok: true,
      change: { created: false, addedQty: 1, version: (milkBefore?.version ?? 0) + 1 },
    });
    expect(res.body.results[2]).toMatchObject({ ok: false, code: 'VALIDATION' });

    // Undo in one request
    const changes = res.body.results.flatMap((r) => (r.ok ? [r.change] : []));
    const undo = await call<BulkUndoResponse>('POST', `/lists/${id}/items/undo`, { changes });
    expect(undo.body).toMatchObject({ undone: 2, failed: 0 });
    const after = (await call<ListDetail>('GET', `/lists/${id}`)).body;
    expect(after.items).toHaveLength(before.items.length);
    expect(after.items.find((i) => i.id === `${MILK}~pack`)?.qty).toBe(milkBefore?.qty);
    // A row changed since is left alone.
    const again = await call<BulkUndoResponse>('POST', `/lists/${id}/items/undo`, {
      changes: changes.slice(1),
    });
    expect(again.body.results[0]).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('rejects a bad request shape', async () => {
    const id = await newList();
    expect((await call('POST', `/lists/${id}/items/bulk`, { items: [] })).status).toBe(400);
    expect((await call('POST', `/lists/${id}/items/bulk`, {})).status).toBe(400);
  });
});
