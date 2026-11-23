// @vitest-environment jsdom
import type { ListDetail } from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { TICKS_KEY } from './cachePersist';
import {
  applyPendingTicks,
  enqueueTick,
  getTickQueue,
  replayTicks,
  resetTickQueue,
} from './tickQueue';

beforeEach(() => {
  localStorage.clear();
  resetTickQueue();
});

describe('tick queue', () => {
  it('keeps order, replaces an earlier tick for the same item and persists', () => {
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    enqueueTick({ listId: 'l1', itemId: 'b', ticked: true });
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: false });
    expect(getTickQueue().map((t) => `${t.itemId}:${t.ticked}`)).toEqual(['b:true', 'a:false']);
    expect(JSON.parse(localStorage.getItem(TICKS_KEY) ?? '[]')).toHaveLength(2);
    resetTickQueue(true); // simulate a reload
    expect(getTickQueue()).toHaveLength(2);
  });

  it('replays oldest first and empties the queue', async () => {
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    enqueueTick({ listId: 'l2', itemId: 'b', ticked: false });
    const sent: string[] = [];
    const r = await replayTicks(async (t) => void sent.push(`${t.listId}/${t.itemId}`));
    expect(sent).toEqual(['l1/a', 'l2/b']);
    expect(r).toMatchObject({ sent: 2, dropped: 0, stopped: false });
    expect([...r.lists].sort()).toEqual(['l1', 'l2']);
    expect(getTickQueue()).toHaveLength(0);
    expect(localStorage.getItem(TICKS_KEY)).toBeNull();
  });

  it('drops ticks for a deleted or archived list/item and carries on', async () => {
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    enqueueTick({ listId: 'l1', itemId: 'b', ticked: true });
    enqueueTick({ listId: 'l1', itemId: 'c', ticked: true });
    const r = await replayTicks(async (t) => {
      if (t.itemId === 'a') throw new ApiError(404, 'NOT_FOUND', 'gone', null);
      if (t.itemId === 'b')
        throw new ApiError(409, 'CONFLICT', 'archived', { reason: 'LIST_ARCHIVED' });
    });
    expect(r).toMatchObject({ sent: 1, dropped: 2, stopped: false });
    expect(getTickQueue()).toHaveLength(0);
  });

  it('stops and keeps the rest on a network error, 5xx or 401', async () => {
    for (const err of [
      new TypeError('Failed to fetch'),
      new ApiError(503, null, 'x', null),
      new ApiError(401, null, 'x', null),
    ]) {
      resetTickQueue();
      enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
      enqueueTick({ listId: 'l1', itemId: 'b', ticked: true });
      const r = await replayTicks(async () => {
        throw err;
      });
      expect(r).toMatchObject({ sent: 0, dropped: 0, stopped: true });
      expect(getTickQueue()).toHaveLength(2);
    }
  });

  it('does not run two replays at once', async () => {
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    let release = () => {};
    const first = replayTicks(() => new Promise<void>((res) => (release = res)));
    const second = await replayTicks(async () => {});
    expect(second.stopped).toBe(true);
    release();
    expect((await first).sent).toBe(1);
  });
});

describe('applyPendingTicks', () => {
  const detail = {
    id: 'l1',
    status: 'active',
    tickedCount: 1,
    items: [
      { id: 'a', ticked: false, tickedAt: null },
      { id: 'b', ticked: true, tickedAt: 'x' },
    ],
  } as unknown as ListDetail;

  it('lays queued ticks over the server copy and recounts', () => {
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    enqueueTick({ listId: 'l1', itemId: 'b', ticked: false });
    enqueueTick({ listId: 'other', itemId: 'a', ticked: false });
    const out = applyPendingTicks(detail);
    expect(out.items.map((i) => i.ticked)).toEqual([true, false]);
    expect(out.tickedCount).toBe(1);
  });

  it('leaves archived lists and untouched lists alone', () => {
    expect(applyPendingTicks(detail)).toBe(detail);
    enqueueTick({ listId: 'l1', itemId: 'a', ticked: true });
    const archived = { ...detail, status: 'archived' } as ListDetail;
    expect(applyPendingTicks(archived)).toBe(archived);
  });
});
