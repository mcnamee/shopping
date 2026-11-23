import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  groupForShop,
  lineIdFor,
  type ListDetail,
  type ListItem,
  type ProductSummary,
  type UnitType,
} from '@trolley/core';
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  MoreVertical,
  PartyPopper,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  ApiError,
  deleteList,
  deleteListItem,
  finishList,
  reopenList,
  saveUnitOverride,
  updateList,
  updateListItem,
} from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast, useToastLift } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { ModalError, QuantityModal, type QuantitySelection } from '../search/QuantityModal';
import {
  ROLLBACK_MESSAGE,
  STALE_MESSAGE,
  isStale,
  noteList,
  noteListGone,
  patchListSummary,
  qk,
  summaryOf,
  upsertListSummary,
  useAisleOrder,
  useListQuery,
  useTemplatesQuery,
  useUnitOverridesQuery,
} from './data';
import { countLabel, shortDay, updatedLabel } from './format';
import { enqueueTick, useTickQueue } from '../offline/tickQueue';
import { useNow, useSettledTicks } from './hooks';
import { AddFromTemplateSheet, ListOptionsSheet, RenameSheet } from './ListSheets';
import { SuggestSheet } from './SuggestSheet';
import { ShopRow } from './ShopRow';

const DELETE_UNDO_MS = 5000;
const ARCHIVE_UNDO_MS = 8000;
const HIGHLIGHT_MS = 2000;

type Sheet =
  | null
  | 'options'
  | 'rename'
  | 'template'
  | 'templateReview'
  | 'suggest'
  | 'regulars'
  | 'finish'
  | 'delete';
type ArchiveInfo = 'own' | 'other' | null;

const progressOf = (items: readonly ListItem[]) => ({
  ticked: items.filter((i) => i.ticked).length,
  total: items.length,
});

/** Snapshot of an item as a product the quantity modal understands. */
function productOf(item: ListItem, effectiveUnit: UnitType): ProductSummary {
  const p = item.product;
  return {
    sku: p.productId,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    price: null,
    unitPrice: null,
    packSize: p.packSize,
    unitType: effectiveUnit,
    defaultUnitType: p.unitType,
    groupId: p.groupId,
    custom: p.productId.startsWith('custom-'),
  };
}

/** Banner copy while offline in shop mode. */
export const offlineTickText = (waiting: number) =>
  `Offline - ticks will sync when you're back online${waiting > 0 ? ` (${waiting} waiting)` : ''}`;

/**
 * /lists/:id. Shop mode for an active list (docs/ux/lists.md 3), read-only view for an archived
 * one (4.2). Optimistic ticks with rollback, 10 s polling plus refetch on focus, deferred
 * deletes with Undo, auto-archive with Undo.
 */
export function ListPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const tickQueue = useTickQueue();
  const routeState = location.state as {
    name?: string;
    from?: string;
    suggest?: boolean;
    regulars?: boolean;
  } | null;

  const [sheet, setSheetRaw] = useState<Sheet>(null);
  // Only ticking works offline (B-006): every other change needs the server.
  const offlineBlocked = useCallback(() => {
    if (online) return false;
    toast.show("You're offline. You can still tick items; other changes need a connection.");
    return true;
  }, [online, toast]);
  const setSheet = useCallback(
    (next: Sheet) => {
      if (next !== null && next !== 'suggest' && next !== 'regulars' && offlineBlocked()) return;
      setSheetRaw(next);
    },
    [offlineBlocked],
  );
  const [editing, setEditing] = useState<{
    item: ListItem;
    opener: HTMLButtonElement | null;
  } | null>(null);
  const [swiping, setSwiping] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo>(null);
  const [announcement, setAnnouncement] = useState('');
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [pickedTemplate, setPickedTemplate] = useState<{ id: string; name: string } | null>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const createdForSuggest = useRef(false);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingIds = useMemo(
    () => new Set(tickQueue.filter((t) => t.listId === id).map((t) => t.itemId)),
    [tickQueue, id],
  );
  const pollRef = useRef(false);
  const query = useListQuery(id, () => pollRef.current);
  const list = query.data;
  const active = list?.status === 'active';
  const sheetOpen = sheet !== null || editing !== null;
  pollRef.current = active && !sheetOpen && !swiping;
  const aisle = useAisleOrder(active);
  const templates = useTemplatesQuery(sheet === 'template' || sheet === 'options');
  const key = qk.list(id);
  const now = useNow(5000);
  const showSkeleton = useDelayedFlag(query.isPending, 150);

  useToastLift(active && list && list.items.length > 0 ? 72 : 0);

  // ---- items as shown (pending deletes hidden) and in settled order
  const items = useMemo(() => (list?.items ?? []).filter((i) => !hidden.has(i.id)), [list, hidden]);
  const settled = useSettledTicks(items, active);
  const sections = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = items.map((i) => ({ ...i, ticked: settled.get(i.id) ?? i.ticked }));
    return groupForShop(ordered, aisle, { tickedFirst: !active }).map((s) => {
      const real = s.items.map((o) => byId.get(o.id) as ListItem);
      return { group: s.group, items: real, ...progressOf(real) };
    });
    // `settled` is a ref-backed map that useSettledTicks mutates and re-renders for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, aisle, active, settled.size, [...settled.values()].join()]);
  const progress = progressOf(items);

  // ---- new rows from the other phone: highlight and announce
  const seen = useRef<Set<string> | null>(null);
  const localIds = useRef(new Set<string>());
  useEffect(() => {
    if (!list) return;
    const ids = list.items.map((i) => i.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((i) => !seen.current?.has(i) && !localIds.current.has(i));
    for (const i of ids) seen.current.add(i);
    if (added.length > 0) {
      setFresh(new Set(added));
      setAnnouncement(`${countLabel(added.length, 'item')} added on another phone.`);
      const t = setTimeout(() => setFresh(new Set()), HIGHLIGHT_MS);
      return () => clearTimeout(t);
    }
  }, [list]);

  // ---- suggestions (docs/ux/suggestions.md)
  const openSuggest = useCallback(() => {
    if (!online) {
      setSheet(null);
      toast.show("You're offline. Reconnect to get suggestions.");
      return;
    }
    setSheet('suggest');
  }, [online, toast, setSheet]);
  // "Create and suggest" lands here with state.suggest: open the sheet once, then clear it.
  const wantsSuggest = routeState?.suggest === true;
  useEffect(() => {
    if (!wantsSuggest || !active) return;
    createdForSuggest.current = true;
    setSheet('suggest');
    navigate(location.pathname, { replace: true, state: { name: routeState?.name } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsSuggest, active]);
  const hasRegulars = templates.data?.templates.some((t) => t.type === 'regulars') ?? false;
  const openRegulars = useCallback(() => {
    if (!online) {
      setSheet(null);
      toast.show("You're offline. Reconnect to review regulars.");
      return;
    }
    setSheet('regulars');
  }, [online, toast, setSheet]);
  // New list flow with a Regulars template: review them (after suggestions, if asked for).
  const wantsRegulars = routeState?.regulars === true;
  const regularsPending = useRef(false);
  useEffect(() => {
    if (!wantsRegulars || !active) return;
    if (wantsSuggest) regularsPending.current = true;
    else setSheet('regulars');
    navigate(location.pathname, {
      replace: true,
      state: { name: routeState?.name },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsRegulars, active]);
  const closeSuggest = (added: boolean) => {
    setSheet(regularsPending.current ? 'regulars' : null);
    regularsPending.current = false;
    if (createdForSuggest.current && !added && list) toast.show(`Created ${list.name}`);
    createdForSuggest.current = false;
  };
  const suggestionsAdded = (ids: string[]) => {
    for (const i of ids) localIds.current.add(i);
    setFresh(new Set(ids));
    if (freshTimer.current) clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFresh(new Set()), HIGHLIGHT_MS);
  };
  useEffect(
    () => () => {
      if (freshTimer.current) clearTimeout(freshTimer.current);
    },
    [],
  );

  // ---- finished on another phone
  const wasActive = useRef(false);
  // Set before our own archive (last tick, Finish) lands, so it is never mistaken for the other phone's.
  const ownArchive = useRef(false);
  useEffect(() => {
    if (active) wasActive.current = true;
    else if (list && wasActive.current && !ownArchive.current && archiveInfo === null)
      setArchiveInfo('other');
  }, [active, list, archiveInfo]);

  // ---- ticks
  const tickKey = ['tick', id] as const;
  /** Apply a tick to the cached list at once. Returns true when it completed (archived) the list. */
  const optimisticTick = (itemId: string, ticked: boolean, canArchive: boolean): boolean => {
    let completes = false;
    qc.setQueryData<ListDetail>(key, (old) => {
      if (!old) return old;
      const next = old.items.map((i) =>
        i.id === itemId ? { ...i, ticked, tickedAt: ticked ? new Date().toISOString() : null } : i,
      );
      const p = progressOf(next);
      completes =
        canArchive && ticked && p.total > 0 && p.ticked === p.total && old.status === 'active';
      if (completes) ownArchive.current = true;
      return {
        ...old,
        items: next,
        tickedCount: p.ticked,
        ...(completes
          ? {
              status: 'archived' as const,
              completedAt: new Date().toISOString(),
              finishedBy: 'auto' as const,
              thisWeek: false,
            }
          : {}),
      };
    });
    patchListSummary(qc, id, (l) => ({
      ...l,
      tickedCount: l.tickedCount + (ticked ? 1 : -1),
    }));
    const item = qc.getQueryData<ListDetail>(key)?.items.find((i) => i.id === itemId);
    setAnnouncement(`${item?.product.name ?? 'Item'} ${ticked ? 'ticked' : 'unticked'}.`);
    return completes;
  };

  const tickMutation = useMutation({
    mutationKey: tickKey,
    networkMode: 'always',
    mutationFn: ({ itemId, ticked }: { itemId: string; ticked: boolean }) =>
      updateListItem(id, itemId, { ticked }),
    onMutate: async ({ itemId, ticked }) => {
      await qc.cancelQueries({ queryKey: key });
      return { completes: optimisticTick(itemId, ticked, true) };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.completes) ownArchive.current = false;
      if (!(err instanceof ApiError)) {
        // No connection (navigator.onLine can lag): keep the tick and sync it when back online.
        enqueueTick({ listId: id, itemId: vars.itemId, ticked: vars.ticked });
        if (ctx?.completes) {
          qc.setQueryData<ListDetail>(key, (old) =>
            old ? { ...old, status: 'active' as const, completedAt: null, finishedBy: null } : old,
          );
        }
        toast.show("No connection. Tick saved on this phone; it'll sync when you're back online.");
        return;
      }
      qc.setQueryData<ListDetail>(key, (old) => {
        if (!old) return old;
        const next = old.items.map((i) =>
          i.id === vars.itemId ? { ...i, ticked: !vars.ticked } : i,
        );
        return {
          ...old,
          items: next,
          tickedCount: progressOf(next).ticked,
          ...(ctx?.completes
            ? { status: 'active' as const, completedAt: null, finishedBy: null }
            : {}),
        };
      });
      toast.show(ctx?.completes ? "Couldn't archive. Check your connection." : ROLLBACK_MESSAGE, {
        action: { label: 'Try again', onAction: () => tickMutation.mutate(vars) },
      });
    },
    onSuccess: (res, vars) => {
      const inFlight = qc.isMutating({ mutationKey: tickKey });
      qc.setQueryData<ListDetail>(key, (old) => {
        if (!old) return old;
        const items = old.items.map((i) =>
          i.id === res.item.id ? { ...res.item, ticked: i.ticked, tickedAt: i.tickedAt } : i,
        );
        const server = res.list;
        // A completing tick archived the list; a lost race shows archived without our tick.
        if (res.archived || server.status === 'archived') {
          return {
            ...old,
            items,
            status: 'archived',
            completedAt: server.completedAt,
            finishedBy: server.finishedBy,
            thisWeek: false,
          };
        }
        if (old.status === 'archived' && inFlight <= 1) {
          ownArchive.current = false;
          return { ...old, items, status: 'active', completedAt: null, finishedBy: null };
        }
        return { ...old, items };
      });
      if (res.archived) {
        setArchiveInfo('own');
        noteList(res.list);
        void qc.invalidateQueries({ queryKey: qk.lists });
        void qc.invalidateQueries({ queryKey: qk.history });
        toast.show('Shop complete - list archived', {
          durationMs: ARCHIVE_UNDO_MS,
          action: { label: 'Undo', onAction: () => void undoArchive() },
        });
        setAnnouncement('Shop complete. List archived.');
      } else if (res.list.status === 'archived') {
        setArchiveInfo('other');
        noteList(res.list);
      }
      void vars;
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: tickKey }) === 1) {
        void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: qk.lists });
      }
    },
  });

  const toggle = useCallback(
    (item: ListItem) => {
      navigator.vibrate?.(10);
      if (!online) {
        // Offline: update the row, queue the tick (persisted) and replay it on reconnect.
        void qc.cancelQueries({ queryKey: key });
        optimisticTick(item.id, !item.ticked, false);
        enqueueTick({ listId: id, itemId: item.id, ticked: !item.ticked });
        return;
      }
      tickMutation.mutate({ itemId: item.id, ticked: !item.ticked });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickMutation, online, id],
  );

  // ---- archive / undo
  const undoArchive = async () => {
    ownArchive.current = false;
    qc.setQueryData<ListDetail>(key, (old) =>
      old ? { ...old, status: 'active', completedAt: null, finishedBy: null } : old,
    );
    setArchiveInfo(null);
    try {
      const res = await reopenList(id);
      // Merge the list fields only: ticks made since Undo was pressed live in the cached items.
      qc.setQueryData<ListDetail>(key, (old) =>
        old
          ? {
              ...old,
              status: res.list.status,
              completedAt: res.list.completedAt,
              finishedBy: res.list.finishedBy,
              thisWeek: res.list.thisWeek,
              version: res.list.version,
            }
          : res.list,
      );
      upsertListSummary(qc, summaryOf(res.list));
      void qc.invalidateQueries({ queryKey: qk.lists });
      void qc.invalidateQueries({ queryKey: qk.history });
    } catch (err) {
      void qc.invalidateQueries({ queryKey: key });
      ownArchive.current = true;
      setArchiveInfo('own');
      toast.show(
        err instanceof ApiError && err.status === 409
          ? 'Too late to undo. The list stays archived.'
          : "Couldn't undo. Check your connection.",
      );
    }
  };

  const finish = async () => {
    setSheet(null);
    ownArchive.current = true;
    try {
      const res = await finishList(id);
      qc.setQueryData(key, res.list);
      noteList(summaryOf(res.list));
      setArchiveInfo('own');
      void qc.invalidateQueries({ queryKey: qk.lists });
      void qc.invalidateQueries({ queryKey: qk.history });
      toast.show('Shop complete - list archived', {
        durationMs: ARCHIVE_UNDO_MS,
        action: { label: 'Undo', onAction: () => void undoArchive() },
      });
      setAnnouncement('Shop complete. List archived.');
    } catch {
      ownArchive.current = false;
      toast.show("Couldn't archive. Check your connection.", {
        action: { label: 'Try again', onAction: () => void finish() },
      });
    }
  };

  // ---- delete item (deferred until the Undo toast ends)
  const pending = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; item: ListItem }>(),
  );

  const commitDelete = useCallback(
    (item: ListItem) => {
      pending.current.delete(item.id);
      deleteListItem(id, item.id).then(
        (res) => {
          qc.setQueryData<ListDetail>(key, (old) =>
            old
              ? {
                  ...old,
                  items: old.items.filter((i) => i.id !== item.id),
                  itemCount: res.list.itemCount,
                  tickedCount: res.list.tickedCount,
                }
              : old,
          );
          setHidden((h) => {
            const n = new Set(h);
            n.delete(item.id);
            return n;
          });
          void qc.invalidateQueries({ queryKey: qk.lists });
        },
        () => {
          setHidden((h) => {
            const n = new Set(h);
            n.delete(item.id);
            return n;
          });
          toast.show(ROLLBACK_MESSAGE);
        },
      );
    },
    // `key` is derived from `id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, qc, toast],
  );

  const removeItem = (item: ListItem) => {
    setHidden((h) => new Set(h).add(item.id));
    const timer = setTimeout(() => commitDelete(item), DELETE_UNDO_MS);
    pending.current.set(item.id, { timer, item });
    setAnnouncement(`Removed ${item.product.name}.`);
    toast.show(`Removed ${item.product.name}`, {
      durationMs: DELETE_UNDO_MS,
      action: {
        label: 'Undo',
        onAction: () => {
          const p = pending.current.get(item.id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.current.delete(item.id);
          setHidden((h) => {
            const n = new Set(h);
            n.delete(item.id);
            return n;
          });
        },
      },
    });
  };

  // Leaving the screen sends any pending deletes at once.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const { timer, item } of map.values()) {
        clearTimeout(timer);
        commitDelete(item);
      }
      map.clear();
    };
  }, [commitDelete]);

  // ---- edit item
  const overrides = useUnitOverridesQuery();
  const saveEdit = async (item: ListItem, sel: QuantitySelection) => {
    const note = sel.note || null;
    const optimisticId = lineIdFor(item.product.productId, sel.unit);
    qc.setQueryData<ListDetail>(key, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((i) =>
              i.id === item.id
                ? { ...i, id: optimisticId, qty: sel.quantity, unit: sel.unit, note }
                : i,
            ),
          }
        : old,
    );
    try {
      const res = await updateListItem(id, item.id, {
        qty: sel.quantity,
        unit: sel.unit,
        note,
        version: item.version,
      });
      localIds.current.add(res.item.id);
      qc.setQueryData<ListDetail>(key, (old) => {
        if (!old) return old;
        const drop = new Set([item.id, optimisticId, res.replacedItemId, res.item.id]);
        const at = old.items.findIndex((i) => i.id === optimisticId || i.id === item.id);
        const rest = old.items.filter((i) => !drop.has(i.id));
        rest.splice(Math.max(0, at), 0, res.item);
        return { ...old, items: rest };
      });
      void qc.invalidateQueries({ queryKey: key });
      if (sel.remember) {
        try {
          await saveUnitOverride(item.product.productId, sel.unit);
          void qc.invalidateQueries({ queryKey: qk.units });
        } catch {
          toast.show("Saved, but couldn't remember the unit.");
        }
      }
      setEditing(null);
    } catch (err) {
      qc.setQueryData<ListDetail>(key, (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === optimisticId ? item : i)) } : old,
      );
      if (isStale(err)) {
        setEditing(null);
        toast.show(STALE_MESSAGE);
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setEditing(null);
        void qc.invalidateQueries({ queryKey: key });
        throw new ModalError('This list has been archived, so it can no longer be changed.');
      }
      throw err;
    }
  };

  // ---- list level actions
  const rename = async (name: string) => {
    if (!list) return;
    try {
      const summary = await updateList(id, { name, version: list.version });
      qc.setQueryData<ListDetail>(key, (old) =>
        old ? { ...old, name: summary.name, version: summary.version } : old,
      );
      noteList(summary);
      upsertListSummary(qc, summary);
      void qc.invalidateQueries({ queryKey: qk.lists });
      setSheet(null);
    } catch (err) {
      if (isStale(err)) {
        setSheet(null);
        toast.show(STALE_MESSAGE);
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      throw err;
    }
  };

  const setThisWeek = async () => {
    setSheet(null);
    if (!list) return;
    try {
      const summary = await updateList(id, { thisWeek: true });
      qc.setQueryData<ListDetail>(key, (old) => (old ? { ...old, thisWeek: true } : old));
      noteList({ ...summary, thisWeek: true });
      upsertListSummary(qc, { ...summary, thisWeek: true });
      void qc.invalidateQueries({ queryKey: qk.lists });
      toast.show(`${list.name} is now this week's list`);
    } catch {
      toast.show(ROLLBACK_MESSAGE);
    }
  };

  const [deleting, setDeleting] = useState(false);
  const removeList = async () => {
    if (!list) return;
    setDeleting(true);
    try {
      await deleteList(id);
      noteListGone(id);
      qc.removeQueries({ queryKey: key });
      qc.setQueryData<{ lists: ListDetail[] }>(qk.lists, (old) =>
        old ? { lists: old.lists.filter((l) => l.id !== id) } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.lists });
      toast.show(`Deleted ${list.name}`);
      navigate('/', { replace: true });
    } catch {
      setDeleting(false);
      setSheet(null);
      toast.show(ROLLBACK_MESSAGE);
    }
  };

  // ---- render
  const name = list?.name ?? routeState?.name ?? '';
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  const backTo =
    active || archiveInfo === 'own'
      ? '/'
      : routeState?.from === 'history' || !routeState
        ? '/lists/history'
        : '/';

  if (query.isPending) {
    return (
      <div aria-busy="true">
        <PageHeader title={name || 'List'} backTo="/" backLabel="Back to lists">
          {name ? (
            <h1 className="min-w-0 flex-1 truncate py-2 text-xl">{name}</h1>
          ) : (
            <Skeleton className="h-6 w-40" />
          )}
        </PageHeader>
        {showSkeleton && (
          <div className="px-4">
            <p className="sr-only">Loading list</p>
            {[0, 1].map((g) => (
              <div key={g}>
                <Skeleton className="my-3 h-4 w-28" />
                {[0, 1, 2, 3].map((r) => (
                  <div key={r} className="flex items-center gap-3 py-3">
                    <Skeleton className="h-[26px] w-[26px]" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                    <Skeleton className="h-5 w-10" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!list) {
    return (
      <div>
        <PageHeader title="List" backTo="/" backLabel="Back to lists" />
        {notFound ? (
          <EmptyView Icon={ShoppingBasket} title="That list isn't here any more.">
            <Link
              to="/"
              className="flex min-h-primary items-center justify-center rounded-md bg-accent text-lg text-accent-on"
            >
              Back to lists
            </Link>
          </EmptyView>
        ) : (
          <ErrorView
            title="Couldn't load this list"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }

  const allTicked = progress.total > 0 && progress.ticked === progress.total;
  const readOnly = !active;
  const pollFailing = active && query.isError;
  const syncText = pollFailing
    ? "Can't update. Retrying..."
    : readOnly
      ? `Finished ${list.completedAt ? shortDay(list.completedAt) : ''}`.trim()
      : updatedLabel(query.dataUpdatedAt, now);

  const pill = (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-lg tabular-nums ${
        readOnly
          ? 'border border-border-subtle bg-surface text-text'
          : allTicked
            ? 'bg-success-soft text-success'
            : 'bg-accent-soft text-accent'
      }`}
    >
      {allTicked && !readOnly && <Check aria-hidden className="h-4 w-4" strokeWidth={3} />}
      <span aria-hidden>
        {progress.ticked}/{progress.total}
      </span>
      <span className="sr-only">
        {progress.ticked} of {progress.total} {readOnly ? 'bought' : 'ticked'}
      </span>
    </span>
  );

  return (
    <div>
      <PageHeader
        title={list.name}
        backTo={backTo}
        backLabel={backTo === '/' ? 'Back to lists' : 'Back to history'}
        right={
          <>
            {pill}
            {active && (
              <button
                type="button"
                ref={optionsButton}
                aria-label="List options"
                aria-haspopup="dialog"
                onClick={() => setSheet('options')}
                className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
              >
                <MoreVertical aria-hidden className="h-6 w-6" />
              </button>
            )}
          </>
        }
        below={
          progress.total > 0 ? (
            <div
              role="progressbar"
              aria-label={readOnly ? 'Items bought' : 'Items ticked'}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.ticked}
              className="h-1 bg-border-subtle"
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${(progress.ticked / progress.total) * 100}%` }}
              />
            </div>
          ) : null
        }
      >
        <div className="min-w-0 flex-1 py-1">
          <h1 className="truncate text-xl">{list.name}</h1>
          <p
            aria-live="off"
            className={`flex items-center gap-1 text-sm font-normal ${pollFailing ? 'text-warning-text' : 'text-muted'}`}
          >
            {pollFailing ? (
              <WifiOff aria-hidden className="h-3.5 w-3.5" />
            ) : (
              active &&
              query.isFetching && <RefreshCw aria-hidden className="h-3 w-3 animate-spin" />
            )}
            <span>{syncText}</span>
          </p>
        </div>
      </PageHeader>

      {active && !online && (
        <div
          role="status"
          className="flex min-h-12 items-center gap-2 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-text"
        >
          <WifiOff aria-hidden className="h-5 w-5 shrink-0" />
          {offlineTickText(tickQueue.length)}
        </div>
      )}
      {active && online && pendingIds.size > 0 && (
        <div
          role="status"
          className="flex min-h-12 items-center gap-2 bg-accent-soft px-4 py-3 text-sm font-semibold text-text"
        >
          <RefreshCw aria-hidden className="h-5 w-5 shrink-0 animate-spin text-accent" />
          Syncing {pendingIds.size === 1 ? '1 tick' : `${pendingIds.size} ticks`}...
        </div>
      )}
      {readOnly && archiveInfo === 'own' && (
        <div
          role="status"
          className="flex min-h-14 items-center gap-2 bg-success-soft px-4 py-3 text-base font-semibold text-success"
        >
          <PartyPopper aria-hidden className="h-6 w-6 shrink-0" />
          Shop complete! This list is archived.
        </div>
      )}
      {readOnly && archiveInfo === 'other' && (
        <div
          role="status"
          className="flex min-h-12 items-center gap-2 bg-accent-soft px-4 py-3 text-sm font-semibold text-text"
        >
          <Info aria-hidden className="h-5 w-5 shrink-0 text-accent" />
          This list was finished on another phone.
        </div>
      )}
      {readOnly && archiveInfo === null && (
        <div className="flex min-h-12 items-center gap-2 bg-accent-soft px-4 py-3 text-sm font-semibold text-text">
          <Archive aria-hidden className="h-5 w-5 shrink-0 text-accent" />
          Archived and read-only. Nothing here can be changed.
        </div>
      )}

      <main className="pb-[calc(56px+32px)]">
        {progress.total === 0 ? (
          readOnly ? (
            <EmptyView Icon={ShoppingBasket} title="Nothing on this list" />
          ) : (
            <EmptyView
              Icon={ShoppingBasket}
              title="Nothing on this list yet"
              body="Add items from search, or bring in a template."
            >
              <Link
                to={`/search?list=${id}`}
                onClick={(e) => {
                  if (offlineBlocked()) e.preventDefault();
                }}
                className="flex min-h-primary items-center justify-center gap-2 rounded-md bg-accent text-lg text-accent-on"
              >
                <Plus aria-hidden className="h-5 w-5" />
                Add items
              </Link>
              <Button variant="secondary" onClick={() => setSheet('template')}>
                Add from template
              </Button>
              <Button variant="secondary" onClick={openSuggest}>
                <Sparkles aria-hidden className="h-5 w-5" />
                Suggest items
              </Button>
            </EmptyView>
          )
        ) : (
          sections.map((s) => {
            const open = !collapsed.has(s.group.id);
            const headingId = `group-${s.group.id}`;
            const all = s.ticked === s.total;
            return (
              <section key={s.group.id} aria-labelledby={headingId}>
                <h2 id={headingId} className="text-xs uppercase tracking-wide text-muted">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((c) => {
                        const n = new Set(c);
                        if (n.has(s.group.id)) n.delete(s.group.id);
                        else n.add(s.group.id);
                        return n;
                      })
                    }
                    className="flex min-h-11 w-full items-center gap-1 border-b border-border-subtle pl-[max(12px,var(--safe-left))] pr-[max(16px,var(--safe-right))] text-left font-bold uppercase"
                  >
                    {open ? (
                      <ChevronDown aria-hidden className="h-5 w-5 shrink-0" />
                    ) : (
                      <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{s.group.name}</span>
                    {all && <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />}
                    <span className="text-sm tabular-nums">
                      <span aria-hidden>
                        {s.ticked}/{s.total}
                      </span>
                      <span className="sr-only">
                        , {s.ticked} of {s.total} {readOnly ? 'bought' : 'ticked'}
                      </span>
                    </span>
                  </button>
                </h2>
                {open && (
                  <ul aria-label={s.group.name}>
                    {s.items.map((item) => (
                      <ShopRow
                        key={item.id}
                        item={item}
                        readOnly={readOnly}
                        highlight={fresh.has(item.id)}
                        pending={pendingIds.has(item.id)}
                        onToggle={toggle}
                        onEdit={(it, button) => {
                          if (!offlineBlocked()) setEditing({ item: it, opener: button });
                        }}
                        onDelete={(it) => {
                          if (!offlineBlocked()) removeItem(it);
                        }}
                        onSwipeChange={setSwiping}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </main>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {active && progress.total > 0 && (
        <Link
          to={`/search?list=${id}`}
          onClick={(e) => {
            if (offlineBlocked()) e.preventDefault();
          }}
          className="fixed bottom-[calc(var(--nav-height)+16px)] right-[max(16px,var(--safe-right))] z-20 flex h-14 items-center gap-2 rounded-full bg-accent px-5 text-lg text-accent-on shadow-sheet active:bg-accent-strong"
        >
          <Plus aria-hidden className="h-6 w-6" />
          Add items
        </Link>
      )}

      {sheet === 'options' && (
        <ListOptionsSheet
          list={list}
          onClose={() => setSheet(null)}
          onRename={() => setSheet('rename')}
          onSetThisWeek={() => void setThisWeek()}
          onAddFromTemplate={() => setSheet('template')}
          onSuggest={openSuggest}
          {...(hasRegulars ? { onRegulars: openRegulars } : {})}
          offline={!online}
          onFinish={() => setSheet('finish')}
          onDelete={() => setSheet('delete')}
        />
      )}
      {sheet === 'rename' && (
        <RenameSheet list={list} onSave={rename} onClose={() => setSheet(null)} />
      )}
      {sheet === 'template' && templates.data?.templates.length === 1 && (
        <SuggestSheet
          list={{ id, name: list.name }}
          mode="template"
          template={{
            id: (templates.data.templates[0] as { id: string }).id,
            name: (templates.data.templates[0] as { name: string }).name,
          }}
          onClose={() => setSheet(null)}
          onAdded={suggestionsAdded}
          returnFocusRef={optionsButton}
        />
      )}
      {sheet === 'template' && templates.data?.templates.length !== 1 && (
        <AddFromTemplateSheet
          templates={templates.data?.templates ?? []}
          onPick={(t) => {
            setPickedTemplate({ id: t.id, name: t.name });
            setSheet('templateReview');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'templateReview' && pickedTemplate && (
        <SuggestSheet
          list={{ id, name: list.name }}
          mode="template"
          template={pickedTemplate}
          onClose={() => setSheet(null)}
          onAdded={suggestionsAdded}
          returnFocusRef={optionsButton}
        />
      )}
      {sheet === 'suggest' && (
        <SuggestSheet
          list={{ id, name: list.name }}
          onClose={closeSuggest}
          onAdded={suggestionsAdded}
          returnFocusRef={optionsButton}
        />
      )}
      {sheet === 'regulars' && (
        <SuggestSheet
          list={{ id, name: list.name }}
          mode="regulars"
          onClose={() => setSheet(null)}
          onAdded={suggestionsAdded}
          returnFocusRef={optionsButton}
        />
      )}
      {sheet === 'finish' && (
        <ConfirmSheet
          tone="primary"
          title="Finish this shop?"
          description={`${
            progress.total - progress.ticked === 1
              ? "1 item isn't ticked."
              : `${progress.total - progress.ticked} items aren't ticked.`
          } They'll be left off your history.`}
          confirm="Finish and archive"
          cancel="Keep shopping"
          onConfirm={() => void finish()}
          onCancel={() => setSheet(null)}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title={`Delete ${list.name}?`}
          description={`This also deletes its ${progress.total} items. This can't be undone.`}
          confirm="Delete list"
          cancel="Cancel"
          busy={deleting}
          onConfirm={() => void removeList()}
          onCancel={() => setSheet(null)}
        />
      )}
      {editing && overrides.isPending && !overrides.isError ? null : editing ? (
        <QuantityModal
          mode="edit"
          product={productOf(
            editing.item,
            overrides.data?.overrides.find((o) => o.productId === editing.item.product.productId)
              ?.unit ?? editing.item.product.unitType,
          )}
          initial={{
            quantity: editing.item.qty,
            unit: editing.item.unit,
            note: editing.item.note ?? '',
          }}
          onConfirm={(sel) => saveEdit(editing.item, sel)}
          onFindInSearch={(product) => {
            setEditing(null);
            navigate(
              `/search?q=${encodeURIComponent(product.name)}&pin=${encodeURIComponent(product.sku)}`,
            );
          }}
          onRemove={() => {
            const item = editing.item;
            setEditing(null);
            removeItem(item);
          }}
          onClose={() => setEditing(null)}
          returnFocusRef={{ current: editing.opener }}
        />
      ) : null}
    </div>
  );
}
