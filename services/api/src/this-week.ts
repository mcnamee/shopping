/**
 * "Add to this week's list" (Stage 2 C2), shared by POST /api/this-week/items and the
 * chatbot's add_item tool (Stage 4 C3): creates and flags "Week of <Monday>" when no
 * active list is flagged, then adds with the merge rule (D-046/D-053).
 */
import { defaultListName, type LineInput, type ListItem } from '@trolley/core';
import { fail } from './http';
import type { ListStore } from './lists/store';

export interface ThisWeekDeps {
  lists: ListStore;
  now: () => Date;
}

/** The flagged list's id when it is still active, else null. */
export async function activeThisWeekId(lists: ListStore, hh: string): Promise<string | null> {
  const id = await lists.thisWeekId(hh);
  if (!id) return null;
  return (await lists.getRecord(hh, id))?.status === 'active' ? id : null;
}

export async function addToThisWeek(
  deps: ThisWeekDeps,
  hh: string,
  userId: string,
  line: LineInput,
): Promise<{ item: ListItem; merged: boolean; listId: string; listCreated: boolean }> {
  const { lists, now } = deps;
  let listId = await activeThisWeekId(lists, hh);
  let listCreated = false;
  if (!listId) {
    const rec = await lists.create(hh, userId, {
      name: defaultListName(now()),
      lines: [],
      thisWeek: undefined,
    });
    const flagged = await lists.thisWeekId(hh);
    if (flagged === rec.id) {
      listId = rec.id;
      listCreated = true;
    } else {
      // The other phone created one at the same moment: use theirs, drop ours.
      await lists.deleteList(hh, rec.id);
      listId = flagged ?? fail.conflict('STALE', 'Changed on another phone');
    }
  }
  const { item, merged } = await lists.addItem(hh, userId, listId, line);
  return { item, merged, listId, listCreated };
}
