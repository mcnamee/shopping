import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Check, ChevronDown, CircleAlert, Star } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  addListItemsBulk,
  addRecipeToList,
  createList,
  matchRecipe,
  saveMatchChoices,
  undoListItemsBulk,
} from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { qk, summaryOf, upsertListSummary, useListsQuery } from '../lists/data';
import { SheetHeader } from '../lists/ListSheets';
import { truncate } from '../search/format';
import { ProductThumb } from '../search/ProductImage';

/** Match results stay fresh for the session (D-116). */
const MATCH_STALE_MS = 30 * 60 * 1000;
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
  // Pantry staples (salt, pepper, water...) start unticked: most households have them.
  const pantry = useMemo(
    () =>
      new Set(
        parsed.flatMap((l, i) =>
          l.kind === 'ingredient' && parseIngredient(l.text).pantry ? [i] : [],
        ),
      ),
    [parsed],
  );
  const [off, setOff] = useState<ReadonlySet<number>>(() => new Set(pantry));
  // Smart matching (D-115): the sheet opens with free-text rows and upgrades when the
  // matches arrive. A failed request silently leaves the rows as text.
  // The response is cached for the session (and 30 days on the server, D-116).
  const matchKey = ['recipe-match', recipe.id, recipe.version] as const;
  const matchQuery = useQuery({
    queryKey: matchKey,
    queryFn: () => matchRecipe(recipe.id),
    enabled: total > 0,
    staleTime: MATCH_STALE_MS,
    gcTime: MATCH_STALE_MS,
    retry: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const matchRows = matchQuery.data?.rows ?? null;
  const matching = (matchQuery.isPending && total > 0) || refreshing;
  const [choice, setChoice] = useState<Readonly<Record<number, string>>>({});
  const [openRow, setOpenRow] = useState<number | null>(null);
  const matchCount = matchRows?.filter((r) => r.match).length ?? 0;
  useEffect(() => {
    if (matchCount > 0) setLive(`${matchCount} matched to ALDI products`);
  }, [matchCount]);
  const refreshMatches = () => {
    if (refreshing) return;
    setRefreshing(true);
    matchRecipe(recipe.id, true)
      .then((res) => {
        qc.setQueryData(matchKey, res);
        setChoice({});
      })
      .catch(() => setLive("Couldn't refresh matches"))
      .finally(() => setRefreshing(false));
  };
  const matchOf = useMemo(() => {
    const byIndex = new Map<number, RecipeMatchRow>();
    let k = 0;
    parsed.forEach((l, i) => {
      if (l.kind !== 'ingredient') return;
      const row = matchRows?.[k++];
      if (row && row.line === l.text) byIndex.set(i, row);
    });
    return byIndex;
  }, [parsed, matchRows]);
  /** The product this row will add, or null for free text. */
  const productFor = (i: number): RecipeMatchProduct | null => {
    const row = matchOf.get(i);
    if (!row) return null;
    const picked = choice[i] ?? row.match?.productId ?? 'text';
    return [row.match, ...row.alternatives].find((p) => p?.productId === picked) ?? null;
  };
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
    const lines: string[] = [];
    // Product rows merge by product and unit (a bulk add rejects repeats in one request).
    const products = new Map<string, AddItemRequest>();
    const note = `From ${recipe.title}`.slice(0, 200);
    parsed.forEach((l, i) => {
      if (l.kind !== 'ingredient' || off.has(i)) return;
      const p = productFor(i);
      if (!p) {
        lines.push(l.text);
        return;
      }
      const key = `${p.productId}|${p.unit}`;
      const prev = products.get(key);
      products.set(key, {
        productId: p.productId,
        unit: p.unit,
        qty: roundQuantity((prev?.qty ?? 0) + p.qty, p.unit),
        note,
      });
    });
    const productItems = [...products.values()];
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
      for (const part of chunk(lines, RECIPE_LIMITS.toListLines)) {
        const res = await addRecipeToList(recipe.id, {
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
    const missed = lines.length + productItems.length - added;
    const merged = changes.filter((c) => !c.created).length;
    const main = `Added ${added} to ${name}${merged ? ` (${merged} combined)` : ''}`;
    const notAdded = missed > 0 ? ` - ${missed} not added${full ? ' - list is full' : ''}` : '';
    const doneId = listId;
    toast.show(main + notAdded, {
      durationMs: 8000,
      action: { label: 'Undo', onAction: () => undo(doneId, changes) },
    });
    // Remember the picks for next time (best effort; the server applies them to the cache).
    const picks = parsed.flatMap((l, i) =>
      l.kind === 'ingredient' && matchOf.has(i) && !off.has(i)
        ? [{ line: l.text, choice: productFor(i)?.productId ?? 'text' }]
        : [],
    );
    if (picks.length > 0) {
      saveMatchChoices(recipe.id, { choices: picks.slice(0, 100) })
        .then(() => qc.invalidateQueries({ queryKey: matchKey }))
        .catch(() => undefined);
    }
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
      {matching ? (
        <p role="status" className="flex items-center gap-2 pb-2 text-sm text-muted">
          <span aria-hidden className="shimmer h-3 w-3 rounded-full" />
          Finding ALDI products...
        </p>
      ) : (
        matchRows && (
          <button
            type="button"
            onClick={refreshMatches}
            className="mb-1 min-h-tap rounded-sm text-sm font-semibold text-accent underline"
          >
            Refresh matches
          </button>
        )
      )}
      <ul aria-label="Ingredients">
        {parsed.map((l, i) => {
          if (l.kind === 'heading') {
            return (
              <li
                key={i}
                className="flex h-10 items-center text-xs uppercase tracking-wide text-muted"
              >
                {l.text}
              </li>
            );
          }
          const row = matchOf.get(i);
          const product = productFor(i);
          const options = row
            ? [row.match, ...row.alternatives].filter((p): p is RecipeMatchProduct => p !== null)
            : [];
          const open = openRow === i && options.length > 0;
          const ticked = !off.has(i);
          return (
            <li key={i} className="border-b border-border-subtle">
              <button
                type="button"
                role="checkbox"
                aria-checked={ticked}
                onClick={() => toggle(i)}
                className="flex min-h-14 w-full items-center gap-1 rounded-sm text-left"
              >
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 ${
                      ticked ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
                    }`}
                  >
                    {ticked && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                </span>
                {product && (
                  <ProductThumb src={product.imageUrl} name={product.name} dim={!ticked} />
                )}
                <span className={`min-w-0 flex-1 py-2 pl-1 ${ticked ? '' : 'text-muted'}`}>
                  {product ? (
                    <>
                      <span className="block break-words text-lg">
                        {describeQuantity(product.qty, product.unit, product.name)}
                      </span>
                      <span className="block break-words text-sm text-muted">{l.text}</span>
                    </>
                  ) : (
                    <span className="block break-words text-lg">{l.text}</span>
                  )}
                  {pantry.has(i) && <span className="block text-sm text-muted">Probably have</span>}
                </span>
              </button>
              {options.length > 0 && (
                <div className="pb-2 pl-12">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${product ? 'Change product' : 'Choose a product'} for ${l.text}`}
                    onClick={() => setOpenRow(open ? null : i)}
                    className="inline-flex min-h-tap items-center gap-1 rounded-full bg-accent-soft px-3 text-sm font-semibold text-accent"
                  >
                    {product ? 'Change' : 'Choose ALDI product'}
                    <ChevronDown aria-hidden className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div role="radiogroup" aria-label={`Product for ${l.text}`} className="mt-1">
                      {[...options.map((o) => o.productId), 'text'].map((id) => {
                        const o = options.find((x) => x.productId === id);
                        const on = (product?.productId ?? 'text') === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              setChoice((c) => ({ ...c, [i]: id }));
                              setOpenRow(null);
                            }}
                            className={`flex min-h-12 w-full items-center gap-2 rounded-sm px-2 text-left ${
                              on ? 'bg-accent-soft' : ''
                            }`}
                          >
                            <span
                              aria-hidden
                              className="flex h-5 w-5 shrink-0 items-center justify-center"
                            >
                              {on && <Check className="h-5 w-5 text-accent" strokeWidth={3} />}
                            </span>
                            {o ? (
                              <>
                                <ProductThumb src={o.imageUrl} name={o.name} />
                                <span className="min-w-0 flex-1">
                                  <span className="block break-words text-base">{o.name}</span>
                                  {o.packSize && (
                                    <span className="block text-sm text-muted">{o.packSize}</span>
                                  )}
                                </span>
                              </>
                            ) : (
                              <span className="flex-1 text-base">Keep as text</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
