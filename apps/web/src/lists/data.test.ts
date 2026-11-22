import type { ListSummary } from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearListOverlay, mergeOverlay, noteList, noteListGone } from './data';

const list = (id: string, over: Partial<ListSummary> = {}): ListSummary => ({
  id,
  name: id,
  status: 'active',
  thisWeek: false,
  itemCount: 0,
  tickedCount: 0,
  createdAt: `2026-11-2${id.length}T00:00:00.000Z`,
  updatedAt: '2026-11-22T00:00:00.000Z',
  completedAt: null,
  finishedBy: null,
  version: 1,
  ...over,
});

describe('GET /lists lag overlay (D-057)', () => {
  beforeEach(() => clearListOverlay());

  it('adds a list the server has not indexed yet', () => {
    noteList(list('new', { thisWeek: true }));
    expect(mergeOverlay([list('a')]).map((l) => l.id)).toEqual(['new', 'a']);
  });

  it('applies a rename and the this-week flag over a stale row, clearing the old flag', () => {
    noteList(list('b', { name: 'Renamed', thisWeek: true, version: 3 }));
    const out = mergeOverlay([list('a', { thisWeek: true }), list('b')]);
    expect(out.find((l) => l.id === 'b')).toMatchObject({
      name: 'Renamed',
      thisWeek: true,
      version: 3,
    });
    expect(out.find((l) => l.id === 'a')?.thisWeek).toBe(false);
  });

  it('drops archived and deleted lists that still show as active', () => {
    noteList(list('a', { status: 'archived' }));
    noteListGone('b');
    expect(mergeOverlay([list('a'), list('b'), list('c')]).map((l) => l.id)).toEqual(['c']);
  });

  it('forgets entries after a few seconds', () => {
    noteListGone('a');
    expect(mergeOverlay([list('a')], Date.now() + 10_000).map((l) => l.id)).toEqual(['a']);
  });
});
