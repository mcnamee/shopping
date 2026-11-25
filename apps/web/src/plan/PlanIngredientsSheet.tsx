import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  RECIPE_LIMITS,
  defaultListName,
  describeQuantity,
  parseIngredient,
  parseIngredientLines,
  roundQuantity,
  sortActiveLists,
  type AddItemRequest,
  type LineChange,
  type Recipe,
  type RecipeMatchProduct,
  type RecipeMatchRow,
} from '@trolley/core';
import { Check, CircleAlert, Star } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import {
  addListItemsBulk,
  addRecipeToList,
  createList,
  getRecipe,
  matchRecipe,
  undoListItemsBulk,
} from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { qk, summaryOf, upsertListSummary, useListsQuery } from '../lists/data';
import { SheetHeader } from '../lists/ListSheets';
import { truncate } from '../search/format';
import { ProductThumb } from '../search/ProductImage';
import { rqk } from '../recipes/data';

const MATCH_STALE_MS = 30 * 60 * 1000;
const FAILED = "Couldn't add those ingredients. Please try again.";
const UNDO_FAILED = "Couldn't undo. Check your connection.";

const chunk = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

interface Row {
  key: string;
  recipeId: string;
  text: string;
  product: RecipeMatchProduct | null;
  pantry: boolean;
}
interface Block {
  recipe: Recipe;
  /** Heading or ingredient, in recipe order. */
  items: Array<{ heading: string } | Row>;
  matching: boolean;
}

/**
 * "Add this week's ingredients" (docs/stages/stage-6.md C1): one review sheet over every
 * recipe in the week or day, grouped by recipe, using the same cached match per recipe as the
 * recipe's own sheet (D-116). Pantry rows start unticked; the same product in two recipes is
 * added once (quantities summed); one Undo takes the whole add back.
 */
export function PlanIngredientsSheet({
  title,
  recipeIds,
  titles,
  onClose,
}: {
  /** "this week", "Tuesday". */
  title: string;
  recipeIds: string[];
  titles: Record<string, string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const lists = useListsQuery();
  const recipeQs = useQueries({
    queries: recipeIds.map((id) => ({
      queryKey: rqk.recipe(id),
      queryFn: () => getRecipe(id),
      retry: false,
    })),
  });
  const matchQs = useQueries({
    queries: recipeIds.map((id, i) => {
      const r = recipeQs[i]?.data;
      return {
        // The same key as the recipe's own sheet, so its cache is shared (D-116).
        queryKey: ['recipe-match', id, r?.version] as const,
        queryFn: () => matchRecipe(id),
        enabled: !!r,
        staleTime: MATCH_STALE_MS,
        gcTime: MATCH_STALE_MS,
        retry: false,
      };
    }),
  });

  const blocks: Block[] = recipeIds.flatMap((id, i) => {
    const recipe = recipeQs[i]?.data;
    if (!recipe) return [];
    const matchRows = matchQs[i]?.data?.rows ?? null;
    let k = 0;
    const items = parseIngredientLines(recipe.ingredients).map((l, n): Block['items'][number] => {
      if (l.kind === 'heading') return { heading: l.text };
      const row: RecipeMatchRow | undefined = matchRows?.[k++];
      return {
        key: `${id}:${n}`,
        recipeId: id,
        text: l.text,
        product: row && row.line === l.text ? row.match : null,
        pantry: parseIngredient(l.text).pantry,
      };
    });
    return [{ recipe, items, matching: matchQs[i]?.isPending ?? false }];
  });
  const rows = blocks.flatMap((b) => b.items.filter((x): x is Row => 'key' in x));
  const loading = recipeQs.some((q) => q.isPending);
  const matching = blocks.some((b) => b.matching);
  const failedLoad = recipeQs.some((q) => q.isError);

  // Untouched rows follow the default (pantry unticked); a tap overrides it.
  const [override, setOverride] = useState<Readonly<Record<string, boolean>>>({});
  const isOn = (r: Row) => override[r.key] ?? !r.pantry;
  const count = rows.filter(isOn).length;
  const allOn = rows.length > 0 && count === rows.length;
  const [live, setLive] = useState('');
  const toggle = (r: Row) => {
    const on = !isOn(r);
    setOverride((o) => ({ ...o, [r.key]: on }));
    setLive(`${count + (on ? 1 : -1)} of ${rows.length} selected`);
  };
  const toggleAll = () => {
    setOverride(Object.fromEntries(rows.map((r) => [r.key, !allOn])));
    setLive(allOn ? `0 of ${rows.length} selected` : `All ${rows.length} selected`);
  };

  // Which other recipes a product also appears in (merged on add).
  const alsoIn = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.product || (override[r.key] ?? !r.pantry) === false) continue;
      const set = m.get(r.product.productId) ?? new Set<string>();
      set.add(r.recipeId);
      m.set(r.product.productId, set);
    }
    return m;
  }, [rows, override]);

  const [picked, setPicked] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const active = sortActiveLists(lists.data?.lists ?? []);
  const week = active.find((l) => l.thisWeek);
  const targetId = picked ?? week?.id ?? active[0]?.id;
  const target = active.find((l) => l.id === targetId);
  const newName = defaultListName(new Date());
  const targetName = target?.name ?? newName;

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
    const textByRecipe = new Map<string, string[]>();
    // Products merge across recipes by product and unit (a bulk add rejects repeats).
    const products = new Map<string, AddItemRequest & { from: Set<string> }>();
    for (const r of rows) {
      if (!isOn(r)) continue;
      const name = titles[r.recipeId] ?? 'plan';
      if (!r.product) {
        textByRecipe.set(r.recipeId, [...(textByRecipe.get(r.recipeId) ?? []), r.text]);
        continue;
      }
      const key = `${r.product.productId}|${r.product.unit}`;
      const prev = products.get(key);
      products.set(key, {
        productId: r.product.productId,
        unit: r.product.unit,
        qty: roundQuantity((prev?.qty ?? 0) + r.product.qty, r.product.unit),
        from: new Set([...(prev?.from ?? []), name]),
      });
    }
    const productItems = [...products.values()].map(({ from, ...p }) => ({
      ...p,
      note: `From ${[...from].join(', ')}`.slice(0, 200),
    }));
    const textCount = [...textByRecipe.values()].reduce((n, l) => n + l.length, 0);
    setBusy(true);
    setBanner(null);
    let listId: string | undefined = target?.id;
    let created = false;
    let added = 0;
    let full = false;
    const changes: LineChange[] = [];
    const collect = (
      results: Array<{ ok: true; change: LineChange } | { ok: false; code: string }>,
    ) => {
      for (const r of results) {
        if (r.ok) changes.push(r.change);
        else if (r.code === 'LIMIT') full = true;
      }
    };
    try {
      for (const [recipeId, lines] of textByRecipe) {
        for (const part of chunk(lines, RECIPE_LIMITS.toListLines)) {
          const res = await addRecipeToList(recipeId, {
            lines: part,
            ...(listId ? { listId } : {}),
          });
          listId = res.listId;
          created ||= res.listCreated;
          added += res.added;
          collect(res.results);
          qc.setQueryData(qk.list(res.listId), res.list);
          upsertListSummary(qc, summaryOf(res.list));
        }
      }
      for (const part of chunk(productItems, 50)) {
        if (!listId) {
          listId = (await createList({})).list.id;
          created = true;
        }
        const res = await addListItemsBulk(listId, part);
        added += res.added;
        collect(res.results);
        qc.setQueryData(qk.list(listId), res.list);
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
    const missed = textCount + productItems.length - added;
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

  const sheetTitle = `Ingredients for ${title}`;
  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={
        <SheetHeader id={headingId} title={sheetTitle} headingRef={heading} onClose={onClose} />
      }
      footer={
        <>
          {banner && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              {banner}
            </p>
          )}
          <Button
            busy={busy}
            busyLabel="Adding..."
            aria-disabled={count === 0 || lists.isPending || loading}
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
          {count} of {rows.length} selected
        </p>
        <button
          type="button"
          onClick={toggleAll}
          className="min-h-tap rounded-sm px-2 text-base font-semibold text-accent underline"
        >
          {allOn ? 'Select none' : 'Select all'}
        </button>
      </div>
      {(loading || matching) && (
        <p role="status" className="flex items-center gap-2 pb-2 text-sm text-muted">
          <span aria-hidden className="shimmer h-3 w-3 rounded-full" />
          {loading ? 'Loading recipes...' : 'Finding ALDI products...'}
        </p>
      )}
      {failedLoad && (
        <p role="alert" className="pb-2 text-sm font-semibold text-danger">
          Some recipes couldn&apos;t be loaded.
        </p>
      )}
      {blocks.map((b) => (
        <section key={b.recipe.id} aria-label={b.recipe.title} className="mb-2">
          <h3 className="flex min-h-10 items-center border-b border-border text-base font-bold">
            {b.recipe.title}
          </h3>
          <ul aria-label={`${b.recipe.title} ingredients`}>
            {b.items.map((it, i) => {
              if ('heading' in it) {
                return (
                  <li
                    key={i}
                    className="flex h-10 items-center text-xs uppercase tracking-wide text-muted"
                  >
                    {it.heading}
                  </li>
                );
              }
              const ticked = isOn(it);
              const others = it.product
                ? [...(alsoIn.get(it.product.productId) ?? [])].filter((id) => id !== it.recipeId)
                : [];
              return (
                <li key={it.key} className="border-b border-border-subtle">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ticked}
                    onClick={() => toggle(it)}
                    className="flex min-h-14 w-full items-center gap-1 rounded-sm text-left"
                  >
                    <span
                      aria-hidden
                      className="flex h-11 w-11 shrink-0 items-center justify-center"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 ${
                          ticked ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
                        }`}
                      >
                        {ticked && <Check className="h-4 w-4" strokeWidth={3} />}
                      </span>
                    </span>
                    {it.product && (
                      <ProductThumb
                        src={it.product.imageUrl}
                        name={it.product.name}
                        dim={!ticked}
                      />
                    )}
                    <span className={`min-w-0 flex-1 py-2 pl-1 ${ticked ? '' : 'text-muted'}`}>
                      {it.product ? (
                        <>
                          <span className="block break-words text-lg">
                            {describeQuantity(it.product.qty, it.product.unit, it.product.name)}
                          </span>
                          <span className="block break-words text-sm text-muted">{it.text}</span>
                        </>
                      ) : (
                        <span className="block break-words text-lg">{it.text}</span>
                      )}
                      {it.pantry && <span className="block text-sm text-muted">Probably have</span>}
                      {ticked && others.length > 0 && (
                        <span className="block text-sm text-muted">
                          Combined with{' '}
                          {others.map((id) => titles[id] ?? 'another recipe').join(', ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </BottomSheet>
  );
}
