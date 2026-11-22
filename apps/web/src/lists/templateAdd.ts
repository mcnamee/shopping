import type { QueryClient } from '@tanstack/react-query';
import { roundQuantity, type AddTemplatesToListResponse } from '@trolley/core';
import { addTemplatesToList, deleteListItem, updateListItem } from '../api';
import type { ToastOptions } from '../components/Toast';
import { qk, summaryOf, upsertListSummary } from './data';

/** Revert a bulk template add: delete created rows, take addedQty off merged ones. */
export async function undoTemplateAdd(
  listId: string,
  res: AddTemplatesToListResponse,
): Promise<void> {
  for (const c of res.changes) {
    if (c.created) {
      await deleteListItem(listId, c.itemId);
      continue;
    }
    const item = res.list.items.find((i) => i.id === c.itemId);
    if (!item) continue;
    await updateListItem(listId, c.itemId, {
      qty: roundQuantity(item.qty - c.addedQty, item.unit),
      version: c.version,
    });
  }
}

/**
 * POST templates onto an active list, update caches and build the toast copy
 * ("Added 12 items (4 combined)", with Undo when anything can be reverted).
 */
export async function addTemplates(
  qc: QueryClient,
  listId: string,
  listName: string,
  templateIds: string[],
  onUndoFailed: () => void,
  /** Templates tab wording names the list; shop mode's does not (docs/ux). */
  named = false,
): Promise<{ message: string; options: ToastOptions }> {
  const res = await addTemplatesToList(listId, templateIds);
  qc.setQueryData(qk.list(listId), res.list);
  upsertListSummary(qc, summaryOf(res.list));
  void qc.invalidateQueries({ queryKey: qk.lists });
  const n = res.added;
  const combined = res.combined > 0 ? ` (${res.combined} combined)` : '';
  const count = `${n} ${n === 1 ? 'item' : 'items'}`;
  const message = named ? `Added ${count} to ${listName}${combined}` : `Added ${count}${combined}`;
  return {
    message,
    options: {
      durationMs: 8000,
      action: {
        label: 'Undo',
        onAction: () => {
          void undoTemplateAdd(listId, res)
            .catch(onUndoFailed)
            .finally(() => {
              void qc.invalidateQueries({ queryKey: qk.list(listId) });
              void qc.invalidateQueries({ queryKey: qk.lists });
            });
        },
      },
    },
  };
}
