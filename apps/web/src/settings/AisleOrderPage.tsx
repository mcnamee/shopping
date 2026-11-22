import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_AISLE_ORDER,
  groupsInOrder,
  isDefaultAisleOrder,
  type AisleOrderResponse,
} from '@trolley/core';
import { Check, ChevronDown, ChevronUp, CircleAlert, GripVertical, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resetAisleOrder, saveAisleOrder } from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { isStale, qk, useAisleOrderQuery } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';

const SAVE_DEBOUNCE_MS = 400;
const ROW_PX = 64;
const EDGE_PX = 90;

type Status = 'idle' | 'saving' | 'saved' | 'failed' | 'stale';

const move = <T,>(arr: readonly T[], from: number, to: number): T[] => {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
};

/** Settings > Aisle order (docs/ux/settings-stage2.md 2): reorder with arrows or drag, auto-saves. */
export function AisleOrderPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const query = useAisleOrderQuery();
  const showSkeleton = useDelayedFlag(query.isPending, 150);

  const [order, setOrder] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [announcement, setAnnouncement] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [drag, setDrag] = useState<{ id: string; from: number; dy: number } | null>(null);

  const saved = useRef<{ order: string[]; version: number } | null>(null);
  const latest = useRef<string[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const again = useRef(false);
  const dirty = useRef(false);
  const failedOrder = useRef<string[] | null>(null);

  // Follow the server unless we have unsaved moves.
  useEffect(() => {
    const d = query.data;
    if (!d || dirty.current || saving.current) return;
    const ids = d.groups.map((g) => g.id);
    saved.current = { order: ids, version: d.version };
    latest.current = ids;
    setOrder(ids);
  }, [query.data]);

  const names = new Map(groupsInOrder(DEFAULT_AISLE_ORDER).map((g) => [g.id, g.name]));
  const nameOf = (id: string) =>
    query.data?.groups.find((g) => g.id === id)?.name ?? names.get(id) ?? id;

  const flush = useCallback(async () => {
    if (saving.current) {
      again.current = true;
      return;
    }
    const next = latest.current;
    const base = saved.current;
    if (!next || !base) return;
    saving.current = true;
    setStatus('saving');
    try {
      const res = await saveAisleOrder(next, base.version);
      saved.current = { order: res.groups.map((g) => g.id), version: res.version };
      qc.setQueryData<AisleOrderResponse>(qk.aisle, res);
      saving.current = false;
      if (again.current) {
        again.current = false;
        void flush();
        return;
      }
      dirty.current = false;
      setStatus('saved');
    } catch (err) {
      saving.current = false;
      again.current = false;
      dirty.current = false;
      if (isStale(err)) {
        setStatus('stale');
        return;
      }
      // Roll back to the last saved order (kept aside for Try again).
      failedOrder.current = next;
      latest.current = saved.current?.order ?? null;
      setOrder(saved.current?.order ?? null);
      setStatus('failed');
    }
  }, [qc]);

  const commit = useCallback(
    (next: string[]) => {
      latest.current = next;
      dirty.current = true;
      setOrder(next);
      setStatus('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (dirty.current) void flush();
      }
    },
    [flush],
  );

  const step = (index: number, dir: -1 | 1) => {
    if (!order || !online) return;
    const to = index + dir;
    if (to < 0 || to >= order.length) return;
    const id = order[index] as string;
    commit(move(order, index, to));
    setAnnouncement(
      `${nameOf(id)} moved ${dir === -1 ? 'up' : 'down'}. Position ${to + 1} of ${order.length}.`,
    );
    // Focus stays on the same button; at an end it moves to the other arrow.
    const atEnd = to === 0 || to === order.length - 1;
    const which = atEnd ? (dir === -1 ? 'down' : 'up') : dir === -1 ? 'up' : 'down';
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-move="${id}-${which}"]`)?.focus(),
    );
  };

  // ---- drag
  const dragRef = useRef<{
    id: string;
    from: number;
    startY: number;
    startScroll: number;
    clientY: number;
  } | null>(null);
  const displayOrder = (() => {
    if (!order || !drag) return order;
    const to = Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / ROW_PX)));
    return move(order, drag.from, to);
  })();

  const endDrag = (apply: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && drag && apply && order && displayOrder) {
      const to = displayOrder.indexOf(d.id);
      if (to !== d.from) {
        commit(displayOrder);
        setAnnouncement(`${nameOf(d.id)} moved. Position ${to + 1} of ${order.length}.`);
      }
    }
    setDrag(null);
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && endDrag(false);
    const edge = setInterval(() => {
      const d = dragRef.current;
      if (!d) return;
      const h = window.innerHeight;
      const by = d.clientY < EDGE_PX ? -12 : d.clientY > h - EDGE_PX ? 12 : 0;
      if (by) {
        window.scrollBy(0, by);
        setDrag((cur) =>
          cur ? { ...cur, dy: d.clientY - d.startY + (window.scrollY - d.startScroll) } : cur,
        );
      }
    }, 16);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(edge);
    };
    // endDrag closes over the latest drag/order on each render; the effect only needs `drag`'s identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);

  const onHandleDown = (e: React.PointerEvent, id: string, index: number) => {
    if (!online || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id,
      from: index,
      startY: e.clientY,
      startScroll: window.scrollY,
      clientY: e.clientY,
    };
    navigator.vibrate?.(10);
    setDrag({ id, from: index, dy: 0 });
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.clientY = e.clientY;
    setDrag({
      id: d.id,
      from: d.from,
      dy: e.clientY - d.startY + (window.scrollY - d.startScroll),
    });
  };

  // ---- reset
  const reset = async () => {
    const previous = saved.current?.order ?? order ?? [];
    setResetting(true);
    try {
      const res = await resetAisleOrder();
      qc.setQueryData(qk.aisle, res);
      const ids = res.groups.map((g) => g.id);
      saved.current = { order: ids, version: res.version };
      latest.current = ids;
      dirty.current = false;
      setOrder(ids);
      setStatus('saved');
      setConfirmReset(false);
      setResetting(false);
      toast.show('Aisle order reset to ALDI order', {
        durationMs: 5000,
        action: {
          label: 'Undo',
          onAction: () => {
            saveAisleOrder(previous, saved.current?.version).then(
              (r) => {
                qc.setQueryData(qk.aisle, r);
                saved.current = { order: r.groups.map((g) => g.id), version: r.version };
                latest.current = saved.current.order;
                setOrder(saved.current.order);
              },
              () => toast.show("Couldn't save. Check your connection."),
            );
          },
        },
      });
    } catch {
      setResetting(false);
      setConfirmReset(false);
      toast.show("Couldn't save. Check your connection.");
    }
  };

  const showLatest = () => {
    dirty.current = false;
    setStatus('idle');
    void query.refetch().then((r) => {
      if (r.data) {
        const ids = r.data.groups.map((g) => g.id);
        saved.current = { order: ids, version: r.data.version };
        latest.current = ids;
        setOrder(ids);
      }
    });
  };

  const isDefault = order ? isDefaultAisleOrder(order) : true;
  const rows = displayOrder ?? [];

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-px">
        <p className="sr-only">Loading aisle order</p>
        {Array.from({ length: 15 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-none" />
        ))}
      </div>
    ) : null;
  } else if (!order) {
    body = (
      <ErrorView
        title="Couldn't load your aisle order"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    body = (
      <>
        <ol aria-label="Aisle order" className="overflow-hidden rounded-md bg-surface">
          {rows.map((id, index) => {
            const dragging = drag?.id === id;
            const to = drag ? rows.indexOf(id) : index;
            const first = index === 0;
            const last = index === rows.length - 1;
            const offset = dragging ? drag.dy - (to - drag.from) * ROW_PX : 0;
            return (
              <li
                key={id}
                style={dragging ? { transform: `translateY(${offset}px)` } : undefined}
                className={`relative flex h-16 items-center gap-1 border-b border-border-subtle pl-4 pr-1 last:border-b-0 ${
                  dragging ? 'z-10 scale-[1.02] bg-surface-raised shadow-sheet' : 'bg-surface'
                }`}
              >
                <span className="w-6 shrink-0 text-sm font-bold tabular-nums text-muted">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 line-clamp-2 text-lg">{nameOf(id)}</span>
                <button
                  type="button"
                  data-move={`${id}-up`}
                  aria-label={`Move ${nameOf(id)} up`}
                  aria-disabled={first || !online}
                  onClick={() => step(index, -1)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm ${first || !online ? 'opacity-40' : 'active:bg-accent-soft'}`}
                >
                  <ChevronUp aria-hidden className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  data-move={`${id}-down`}
                  aria-label={`Move ${nameOf(id)} down`}
                  aria-disabled={last || !online}
                  onClick={() => step(index, 1)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm ${last || !online ? 'opacity-40' : 'active:bg-accent-soft'}`}
                >
                  <ChevronDown aria-hidden className="h-6 w-6" />
                </button>
                <span
                  aria-hidden
                  data-testid={`drag-${id}`}
                  onPointerDown={(e) => onHandleDown(e, id, index)}
                  onPointerMove={onHandleMove}
                  onPointerUp={() => endDrag(true)}
                  onPointerCancel={() => endDrag(false)}
                  className="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center text-muted"
                >
                  <GripVertical className="h-6 w-6" />
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-4">
          <Button
            variant="secondary"
            aria-disabled={isDefault || !online}
            onClick={() => !isDefault && online && setConfirmReset(true)}
          >
            <RotateCcw aria-hidden className="h-5 w-5" />
            Reset to ALDI order
          </Button>
          {isDefault && <p className="mt-1 text-sm text-muted">Already using the ALDI order.</p>}
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Aisle order" backTo="/settings" backLabel="Back to settings" />
      <main className="px-[max(16px,var(--safe-left))] pb-4 pt-4">
        <p className="text-base text-muted">
          Shop mode follows this order, top to bottom. Drag the handle, or use the arrows.
        </p>
        {!online && (
          <p className="mt-1 text-sm text-muted">You're offline. Reconnect to change the order.</p>
        )}
        <p
          role="status"
          aria-live="polite"
          className="my-2 flex min-h-5 items-center gap-1 text-sm text-muted"
        >
          {status === 'saving' && 'Saving...'}
          {status === 'saved' && (
            <>
              <Check aria-hidden className="h-3.5 w-3.5 text-success" strokeWidth={3} />
              <span>Saved</span>
            </>
          )}
        </p>
        {status === 'failed' && (
          <div
            role="alert"
            className="mb-3 flex items-center gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
          >
            <CircleAlert aria-hidden className="h-5 w-5 shrink-0" />
            <span className="flex-1">Couldn't save the new order. Please try again.</span>
            <button
              type="button"
              onClick={() => failedOrder.current && commit(failedOrder.current)}
              className="min-h-tap rounded-sm px-2 font-bold underline"
            >
              Try again
            </button>
          </div>
        )}
        {status === 'stale' && (
          <div
            role="alert"
            className="mb-3 flex items-center gap-2 rounded-sm bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-text"
          >
            <span className="flex-1">Changed on another phone.</span>
            <button
              type="button"
              onClick={showLatest}
              className="min-h-tap rounded-sm px-2 font-bold underline"
            >
              Show latest
            </button>
          </div>
        )}
        {body}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </main>
      {confirmReset && (
        <ConfirmSheet
          tone="primary"
          title="Reset the aisle order?"
          description="Groups go back to the usual ALDI walk order. Your lists will follow it straight away."
          confirm="Reset order"
          cancel="Cancel"
          busy={resetting}
          onConfirm={() => void reset()}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
