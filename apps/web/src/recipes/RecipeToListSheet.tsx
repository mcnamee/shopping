import { useQueryClient } from '@tanstack/react-query';
import {
  RECIPE_LIMITS,
  defaultListName,
  parseIngredientLines,
  sortActiveLists,
  type LineChange,
  type Recipe,
} from '@trolley/core';
import { Check, CircleAlert, Star } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { addRecipeToList, undoListItemsBulk } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { qk, summaryOf, upsertListSummary, useListsQuery } from '../lists/data';
import { SheetHeader } from '../lists/ListSheets';
import { truncate } from '../search/format';

const FAILED = "Couldn't add those ingredients. Please try again.";
const UNDO_FAILED = "Couldn't undo. Check your connection.";

const chunk = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * "Add to list" review sheet for a recipe (docs/stages/stage-5.md F): ingredient lines all
 * ticked, headings as group labels, sticky Select all/none, target list picker.
 */
export function RecipeToListSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const lists = useListsQuery();
  const parsed = useMemo(() => parseIngredientLines(recipe.ingredients), [recipe.ingredients]);
  const total = parsed.filter((l) => l.kind === 'ingredient').length;
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const [picked, setPicked] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [live, setLive] = useState('');

  const active = sortActiveLists(lists.data?.lists ?? []);
  const week = active.find((l) => l.thisWeek);
  const targetId = picked ?? week?.id ?? active[0]?.id;
  const target = active.find((l) => l.id === targetId);
  // No active list at all: a blank "Week of ..." is created on confirm (D-048).
  const newName = defaultListName(new Date());
  const targetName = target?.name ?? newName;
  const count = total - off.size;
  const allOn = off.size === 0;

  const toggle = (i: number) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      setLive(`${total - n.size} of ${total} selected`);
      return n;
    });
  const toggleAll = () => {
    const ids = parsed.flatMap((l, i) => (l.kind === 'ingredient' ? [i] : []));
    setOff(allOn ? new Set(ids) : new Set());
    setLive(allOn ? `0 of ${total} selected` : `All ${total} selected`);
  };

  const undo = (listId: string, changes: LineChange[]) => {
    void (async () => {
      let undone = 0;
      for (const part of chunk(changes, RECIPE_LIMITS.toListLines)) {
        const res = await undoListItemsBulk(listId, part);
        undone += res.undone;
        qc.setQueryData(qk.list(listId), res.list);
        upsertListSummary(qc, summaryOf(res.list));
      }
      toast.show(`Removed ${undone} ${undone === 1 ? 'item' : 'items'}`);
    })()
      .catch(() =>
        toast.show(UNDO_FAILED, {
          durationMs: 8000,
          action: { label: 'Try again', onAction: () => undo(listId, changes) },
        }),
      )
      .finally(() => {
        void qc.invalidateQueries({ queryKey: qk.list(listId) });
        void qc.invalidateQueries({ queryKey: qk.lists });
      });
  };

  const confirm = async () => {
    if (busy) return;
    if (count === 0) {
      setLive('Tick at least one ingredient');
      return;
    }
    const lines = parsed.flatMap((l, i) =>
      l.kind === 'ingredient' && !off.has(i) ? [l.text] : [],
    );
    setBusy(true);
    setBanner(null);
    let listId: string | undefined = target?.id;
    let created = false;
    let added = 0;
    let full = false;
    const changes: LineChange[] = [];
    try {
      for (const part of chunk(lines, RECIPE_LIMITS.toListLines)) {
        const res = await addRecipeToList(recipe.id, {
          lines: part,
          ...(listId ? { listId } : {}),
        });
        listId = res.listId;
        created ||= res.listCreated;
        added += res.added;
        for (const r of res.results) {
          if (r.ok) changes.push(r.change);
          else if (r.code === 'LIMIT') full = true;
        }
        qc.setQueryData(qk.list(res.listId), res.list);
        upsertListSummary(qc, summaryOf(res.list));
      }
    } catch {
      if (added === 0 || !listId) {
        setBusy(false);
        setBanner(FAILED);
        return;
      }
    }
    void qc.invalidateQueries({ queryKey: qk.lists });
    if (added === 0 || !listId) {
      setBusy(false);
      setBanner(full ? 'That list is full (200 items).' : FAILED);
      return;
    }
    const name = created ? newName : targetName;
    const missed = lines.length - added;
    const merged = changes.filter((c) => !c.created).length;
    const main = `Added ${added} to ${name}${merged ? ` (${merged} combined)` : ''}`;
    const notAdded = missed > 0 ? ` - ${missed} not added${full ? ' - list is full' : ''}` : '';
    const doneId = listId;
    toast.show(main + notAdded, {
      durationMs: 8000,
      action: { label: 'Undo', onAction: () => undo(doneId, changes) },
    });
    onClose();
  };

  const err = (msg: string) => (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
    >
      <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      {msg}
    </p>
  );

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={
        <SheetHeader id={headingId} title="Add to list" headingRef={heading} onClose={onClose} />
      }
      footer={
        <>
          {banner && err(banner)}
          <Button
            busy={busy}
            busyLabel="Adding..."
            aria-disabled={count === 0 || lists.isPending}
            aria-label={count === 0 ? 'Add ingredients' : `Add ${count} to ${targetName}`}
            onClick={() => void confirm()}
          >
            {count === 0 ? 'Add ingredients' : `Add ${count} to ${truncate(targetName, 24)}`}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div role="status" aria-live="polite" className="sr-only">
        {live}
      </div>
      <section aria-labelledby={`${headingId}-to`} className="mb-3">
        <h3 id={`${headingId}-to`} className="mb-1 text-xs uppercase tracking-wide text-muted">
          Add to
        </h3>
        {lists.isPending ? (
          <div className="shimmer h-14 rounded-md" aria-hidden />
        ) : active.length === 0 ? (
          <p className="rounded-md bg-accent-soft px-3 py-3 text-base">
            New list: <span className="font-semibold">{newName}</span>
          </p>
        ) : (
          <div role="radiogroup" aria-label="Add to list" className="space-y-2">
            {active.map((l) => {
              const on = l.id === targetId;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(l.id)}
                  className={`flex min-h-14 w-full items-center gap-2 rounded-md border-2 px-3 text-left ${
                    on ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {on && <Check aria-hidden className="h-5 w-5 text-accent" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg">{l.name}</span>
                  {l.thisWeek && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                      <Star aria-hidden className="h-3.5 w-3.5" />
                      This week
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
      <div className="sticky -top-1 z-20 -mt-1 flex min-h-12 items-center justify-between gap-2 bg-bg pt-1">
        <p aria-hidden className="text-sm text-muted">
          {count} of {total} selected
        </p>
        <button
          type="button"
          onClick={toggleAll}
          className="min-h-tap rounded-sm px-2 text-base font-semibold text-accent underline"
        >
          {allOn ? 'Select none' : 'Select all'}
        </button>
      </div>
      <ul aria-label="Ingredients">
        {parsed.map((l, i) =>
          l.kind === 'heading' ? (
            <li
              key={i}

              className="flex h-10 items-center text-xs uppercase tracking-wide text-muted"
            >
              {l.text}
            </li>
          ) : (
            <li key={i} className="border-b border-border-subtle">
              <button
                type="button"
                role="checkbox"
                aria-checked={!off.has(i)}
                onClick={() => toggle(i)}
                className="flex min-h-14 w-full items-center gap-1 rounded-sm text-left"
              >
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 ${
                      !off.has(i) ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
                    }`}
                  >
                    {!off.has(i) && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                </span>
                <span
                  className={`min-w-0 flex-1 break-words py-2 text-lg ${off.has(i) ? 'text-muted' : ''}`}
                >
                  {l.text}
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
    </BottomSheet>
  );
}
