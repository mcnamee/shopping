// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CACHE_KEY,
  MAX_CACHED_LISTS,
  clearOfflineData,
  hasCachedLists,
  readPersistedUser,
  restoreCache,
  saveCache,
  savePersistedUser,
  serialiseCache,
} from './cachePersist';

const client = () => new QueryClient();

function seed(qc: QueryClient, n = 1) {
  qc.setQueryData(['lists'], { lists: [{ id: 'l0' }] });
  for (let i = 0; i < n; i++) qc.setQueryData(['list', `l${i}`], { id: `l${i}`, items: [] });
  qc.setQueryData(['history'], { pages: [] });
}

beforeEach(() => localStorage.clear());

describe('offline cache', () => {
  it('round-trips lists and list detail for the same user, but not history', () => {
    const a = client();
    seed(a, 2);
    saveCache(a, 'u1');
    const b = client();
    expect(restoreCache(b, 'u1')).toBe(true);
    expect(b.getQueryData(['list', 'l1'])).toEqual({ id: 'l1', items: [] });
    expect(b.getQueryData(['lists'])).toBeTruthy();
    expect(b.getQueryData(['history'])).toBeUndefined();
    expect(hasCachedLists('u1')).toBe(true);
  });

  it('is never handed to another user', () => {
    const a = client();
    seed(a);
    saveCache(a, 'u1');
    expect(restoreCache(client(), 'u2')).toBe(false);
    expect(hasCachedLists('u2')).toBe(false);
  });

  it('caps the number of cached list details, newest kept', () => {
    const a = client();
    seed(a, MAX_CACHED_LISTS + 5);
    const kept = JSON.parse(serialiseCache(a, 'u1')).state.queries.filter(
      (q: { queryKey: string[] }) => q.queryKey[0] === 'list',
    );
    expect(kept).toHaveLength(MAX_CACHED_LISTS);
  });

  it('survives corrupt or unavailable storage', () => {
    localStorage.setItem(CACHE_KEY, '{nope');
    expect(restoreCache(client(), 'u1')).toBe(false);
    expect(hasCachedLists('u1')).toBe(false);
    const a = client();
    seed(a);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => saveCache(a, 'u1')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('remembers the user and forgets everything on clear', () => {
    savePersistedUser({ userId: 'u1', email: 'a@b.c', householdId: 'h' });
    expect(readPersistedUser()).toEqual({ userId: 'u1', email: 'a@b.c', householdId: 'h' });
    const a = client();
    seed(a);
    saveCache(a, 'u1');
    clearOfflineData();
    expect(readPersistedUser()).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});
