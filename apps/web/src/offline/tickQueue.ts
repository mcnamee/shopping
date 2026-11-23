import type { ListDetail } from '@trolley/core';
import { useSyncExternalStore } from 'react';
import { ApiError } from '../api/client';
import { TICKS_KEY } from './cachePersist';

/**
 * Ticks and unticks made offline (B-006, D-102). A tick is an idempotent "set ticked" with no
 * version (D-058), so replaying is safe and the last action per item is the only one that
 * matters: a later entry for the same item replaces the earlier one. Entries persist in
 * localStorage so they survive a reload or a cold start, and replay in order on reconnect.
 */
export interface QueuedTick {
  seq: number;
  listId: string;
  itemId: string;
  ticked: boolean;
  at: number;
}

let queue: readonly QueuedTick[] = load();
let nextSeq = queue.reduce((m, t) => Math.max(m, t.seq), 0) + 1;
const listeners = new Set<() => void>();

function load(): QueuedTick[] {
  try {
    const raw = globalThis.localStorage?.getItem(TICKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (t): t is QueuedTick =>
        !!t &&
        typeof t.seq === 'number' &&
        typeof t.listId === 'string' &&
        typeof t.itemId === 'string' &&
        typeof t.ticked === 'boolean',
    );
  } catch {
    return [];
  }
}

function commit(next: readonly QueuedTick[]): void {
  queue = next;
  try {
    if (next.length) globalThis.localStorage?.setItem(TICKS_KEY, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(TICKS_KEY);
  } catch {
    // Kept in memory for this session even if storage is full.
  }
  for (const l of listeners) l();
}

export const getTickQueue = () => queue;

export function subscribeTickQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTickQueue(): readonly QueuedTick[] {
  return useSyncExternalStore(subscribeTickQueue, getTickQueue, getTickQueue);
}

export function enqueueTick(t: { listId: string; itemId: string; ticked: boolean }): void {
  const rest = queue.filter((q) => !(q.listId === t.listId && q.itemId === t.itemId));
  commit([...rest, { ...t, seq: nextSeq++, at: Date.now() }]);
}

export function removeTick(seq: number): void {
  if (queue.some((q) => q.seq === seq)) commit(queue.filter((q) => q.seq !== seq));
}

/** Test seam and sign-out: forget every queued tick (also re-reads storage). */
export function resetTickQueue(reload = false): void {
  commit(reload ? load() : []);
}

/** Queued ticks laid over a freshly fetched list, so a refetch never flips a waiting row back. */
export function applyPendingTicks(
  detail: ListDetail,
  q: readonly QueuedTick[] = queue,
): ListDetail {
  const mine = q.filter((t) => t.listId === detail.id);
  if (mine.length === 0 || detail.status !== 'active') return detail;
  const want = new Map(mine.map((t) => [t.itemId, t]));
  const items = detail.items.map((i) => {
    const t = want.get(i.id);
    if (!t || t.ticked === i.ticked) return i;
    return { ...i, ticked: t.ticked, tickedAt: t.ticked ? new Date(t.at).toISOString() : null };
  });
  return { ...detail, items, tickedCount: items.filter((i) => i.ticked).length };
}

export interface ReplayResult {
  sent: number;
  /** Ticks the server refused for good (list archived or deleted, item gone). */
  dropped: number;
  /** Stopped early on a network or server error: try again later. */
  stopped: boolean;
  lists: Set<string>;
}

let replaying = false;

/**
 * Send queued ticks one at a time, oldest first. 404 and other 4xx (list or item gone, list
 * archived) are dropped; network errors, 5xx and 401 stop the run and keep the rest queued.
 */
export async function replayTicks(
  send: (t: QueuedTick) => Promise<unknown>,
): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, dropped: 0, stopped: false, lists: new Set() };
  if (replaying) return { ...result, stopped: true };
  replaying = true;
  try {
    for (;;) {
      const head = queue[0];
      if (!head) break;
      try {
        await send(head);
        result.sent++;
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 401 &&
          err.status !== 429
        ) {
          result.dropped++;
        } else {
          result.stopped = true;
          break;
        }
      }
      result.lists.add(head.listId);
      removeTick(head.seq);
    }
  } finally {
    replaying = false;
  }
  return result;
}
