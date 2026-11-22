import { useQueryClient } from '@tanstack/react-query';
import { describeQuantity, roundQuantity, type ListItem, type TemplateItem } from '@trolley/core';
import {
  ApiError,
  addListItem,
  addTemplateItem,
  addThisWeekItem,
  deleteListItem,
  deleteTemplateItem,
  saveUnitOverride,
  updateListItem,
  updateTemplateItem,
} from '../api';
import { useToast } from '../components/Toast';
import { qtyLabel } from '../lists/format';
import { conflictReason, noteList, qk } from '../lists/data';
import { ModalError, type QuantitySelection } from './QuantityModal';
import { sessionTargets, type AddTarget } from './target';

const UNDO_MS = 5000;

export interface AddResult {
  listId?: string;
  templateId?: string;
}

function addErrorMessage(err: unknown, target: AddTarget): Error {
  const noun = target.kind === 'template' ? 'template' : 'list';
  if (err instanceof ApiError) {
    const reason = conflictReason(err);
    if (reason === 'LIMIT') {
      return new ModalError(
        target.kind === 'template'
          ? 'This template is full (100 items). Remove something first.'
          : 'This list is full (200 items). Remove something first.',
      );
    }
    if (reason === 'LIST_ARCHIVED') {
      return new ModalError('That list has been archived. Choose another one.');
    }
    if (err.status === 404) return new ModalError(`That ${noun} isn't here any more.`);
  }
  return err instanceof Error ? err : new Error('add failed');
}

/**
 * Persists a quantity-modal confirm (stage-2 C1 to C5): adds to the target, saves the unit
 * override when asked, remembers the target for this session and shows the Undo toast.
 */
export function useAddToTarget() {
  const qc = useQueryClient();
  const toast = useToast();

  const refresh = (listId?: string, templateId?: string) => {
    void qc.invalidateQueries({ queryKey: qk.lists });
    void qc.invalidateQueries({ queryKey: qk.templates });
    if (listId) void qc.invalidateQueries({ queryKey: qk.list(listId) });
    if (templateId) void qc.invalidateQueries({ queryKey: qk.template(templateId) });
  };

  /** Saves the household unit override. False when it failed (its own toast is shown). */
  const rememberUnit = async ({ product, unit, remember }: QuantitySelection) => {
    if (!remember) return true;
    try {
      await saveUnitOverride(product.sku, unit);
      void qc.invalidateQueries({ queryKey: qk.units });
      void qc.invalidateQueries({ queryKey: ['products'] });
      return true;
    } catch {
      toast.show("Added, but couldn't remember the unit.");
      return false;
    }
  };

  const undoList =
    (listId: string, item: ListItem, merged: boolean, addedQty: number) => async () => {
      try {
        if (!merged) await deleteListItem(listId, item.id);
        else {
          await updateListItem(listId, item.id, {
            qty: roundQuantity(item.qty - addedQty, item.unit),
            version: item.version,
          });
        }
      } catch {
        toast.show("Couldn't undo. Check your connection.");
      }
      refresh(listId);
    };

  const undoTemplate =
    (templateId: string, item: TemplateItem, merged: boolean, addedQty: number) => async () => {
      try {
        if (!merged) await deleteTemplateItem(templateId, item.id);
        else {
          await updateTemplateItem(templateId, item.id, {
            qty: roundQuantity(item.qty - addedQty, item.unit),
            version: item.version,
          });
        }
      } catch {
        toast.show("Couldn't undo. Check your connection.");
      }
      refresh(undefined, templateId);
    };

  return async function add(target: AddTarget, selection: QuantitySelection): Promise<AddResult> {
    const { product, quantity, unit, note } = selection;
    const body = { productId: product.sku, qty: quantity, unit, note: note || null };
    const what = describeQuantity(quantity, unit, product.name);

    try {
      if (target.kind === 'template') {
        const res = await addTemplateItem(target.id, body);
        sessionTargets.remember(target);
        qc.setQueryData(qk.template(target.id), res.template);
        refresh(undefined, target.id);
        if (await rememberUnit(selection))
          toast.show(
            res.merged
              ? `Updated ${product.name}: now ${qtyLabel(res.item.qty, unit)} in ${target.name}`
              : `Added ${what} to ${target.name}`,
            {
              durationMs: UNDO_MS,
              action: {
                label: 'Undo',
                onAction: () => void undoTemplate(target.id, res.item, res.merged, quantity)(),
              },
            },
          );
        return { templateId: target.id };
      }

      const res =
        target.kind === 'thisWeek'
          ? await addThisWeekItem(body)
          : await addListItem(target.id, body);
      noteList(res.list);
      const listId = res.list.id;
      sessionTargets.remember(
        target.kind === 'thisWeek' ? { kind: 'list', id: listId, name: res.list.name } : target,
      );
      refresh(listId);
      const where = target.kind === 'list' && target.name ? target.name : res.list.name;
      if (await rememberUnit(selection))
        toast.show(
          res.listCreated
            ? `Added ${what} to a new list, ${where}`
            : res.merged
              ? `Updated ${product.name}: now ${qtyLabel(res.item.qty, unit)} in ${where}`
              : `Added ${what} to ${where}`,
          {
            durationMs: UNDO_MS,
            action: {
              label: 'Undo',
              onAction: () => void undoList(listId, res.item, res.merged, res.addedQty)(),
            },
          },
        );
      return { listId };
    } catch (err) {
      throw addErrorMessage(err, target);
    }
  };
}
