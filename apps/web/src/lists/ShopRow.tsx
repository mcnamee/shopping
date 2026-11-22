import type { ListItem } from '@trolley/core';
import { Check, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { qtyLabel } from './format';

const OPEN_PX = 96;
const INTENT_PX = 10;

interface ShopRowProps {
  item: ListItem;
  /** Archived view: static row, no controls. */
  readOnly?: boolean;
  /** Fresh from the other phone: 2 s accent-soft highlight. */
  highlight?: boolean;
  onToggle?: (item: ListItem) => void;
  onEdit?: (item: ListItem, button: HTMLButtonElement) => void;
  onDelete?: (item: ListItem) => void;
  onSwipeChange?: (active: boolean) => void;
}

/** "2 L . Get lactose free" meta line: pack size then note (docs/ux/lists.md 3.4). */
function metaLine(item: ListItem) {
  return [item.product.packSize, item.note].filter(Boolean) as string[];
}

/**
 * Shop-mode row (docs/ux/lists.md 3.4, lead ruling): the whole row is the tick target
 * (role=checkbox, >= 56 px), a separate pencil opens the edit sheet, swipe left deletes.
 * Archived rows are static.
 */
export function ShopRow({
  item,
  readOnly = false,
  highlight = false,
  onToggle,
  onEdit,
  onDelete,
  onSwipeChange,
}: ShopRowProps) {
  const { product, qty, unit, ticked } = item;
  const qtyText = qtyLabel(qty, unit);
  const meta = metaLine(item);
  const li = useRef<HTMLLIElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; swiping: boolean; id: number } | null>(
    null,
  );
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const width = () => li.current?.getBoundingClientRect().width || 358;

  const settle = (next: number, isOpen: boolean) => {
    setDx(next);
    setOpen(isOpen);
    setDragging(false);
    onSwipeChange?.(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('[data-swipe-ignore]')) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      base: open ? -OPEN_PX : 0,
      swiping: false,
      id: e.pointerId,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.swiping) {
      if (Math.abs(mx) < INTENT_PX || Math.abs(my) > Math.abs(mx)) return;
      d.swiping = true;
      setDragging(true);
      onSwipeChange?.(true);
      li.current?.setPointerCapture?.(d.id);
    }
    setDx(Math.max(-width(), Math.min(0, d.base + mx)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.swiping) return;
    swiped.current = true;
    setTimeout(() => (swiped.current = false), 0);
    const total = d.base + (e.clientX - d.x);
    const ratio = -total / width();
    if (ratio >= 0.4) {
      settle(0, false);
      onDelete?.(item);
    } else if (ratio >= 0.15) settle(-OPEN_PX, true);
    else settle(0, false);
  };
  const onPointerCancel = () => {
    if (drag.current?.swiping) settle(open ? -OPEN_PX : 0, open);
    drag.current = null;
  };

  const bodyText = (
    <>
      <span
        className={`line-clamp-2 break-words text-lg ${ticked ? 'text-muted line-through' : 'text-text'}`}
      >
        {product.name}
      </span>
      {(meta.length > 0 || readOnly) && (
        <span className="block truncate text-sm font-normal text-muted">
          {readOnly && <span className="sr-only">{ticked ? 'Bought. ' : 'Not bought. '}</span>}
          {readOnly && !ticked && <span aria-hidden>Not bought{meta.length ? ' · ' : ''}</span>}
          {!product.packSize && item.note && (
            <MessageSquare aria-hidden className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          )}
          {meta.join(' · ')}
        </span>
      )}
    </>
  );

  const qtyEl = (
    <span
      className={`max-w-24 shrink-0 whitespace-nowrap text-right text-lg font-bold tabular-nums ${
        ticked ? 'text-muted line-through' : 'text-text'
      }`}
    >
      {qtyText}
    </span>
  );

  const box = (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-[3px] ${
        ticked ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
      }`}
    >
      {ticked && <Check className="h-[22px] w-[22px]" strokeWidth={3} />}
    </span>
  );

  if (readOnly) {
    return (
      <li className="flex min-h-16 items-center gap-3 border-b border-border-subtle px-[max(16px,var(--safe-left))] py-2">
        {box}
        <span className="min-w-0 flex-1">{bodyText}</span>
        {qtyEl}
      </li>
    );
  }

  return (
    <li
      ref={li}
      data-testid="shop-row"
      className="relative overflow-hidden border-b border-border-subtle bg-bg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {dx !== 0 && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-danger text-danger-on"
          style={{ width: Math.max(OPEN_PX, -dx) }}
        >
          {open ? (
            <button
              type="button"
              data-swipe-ignore
              onClick={() => {
                settle(0, false);
                onDelete?.(item);
              }}
              className="flex h-full w-24 flex-col items-center justify-center gap-1 text-lg"
            >
              <Trash2 aria-hidden className="h-6 w-6" />
              <span aria-hidden>Delete</span>
              <span className="sr-only">Delete {product.name}</span>
            </button>
          ) : (
            <span aria-hidden className="flex flex-col items-center gap-1 text-lg">
              <Trash2 className="h-6 w-6" />
              Delete
            </span>
          )}
        </div>
      )}
      <div
        className={`relative flex min-h-16 touch-pan-y items-stretch bg-bg ${
          highlight ? 'bg-accent-soft' : ''
        } ${dragging ? '' : 'transition-transform'}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={`${product.name}, ${qtyText}`}
          onClick={() => {
            if (swiped.current) return;
            if (open) {
              settle(0, false);
              return;
            }
            onToggle?.(item);
          }}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 pl-[max(16px,var(--safe-left))] text-left active:bg-accent-soft"
        >
          {box}
          <span className="min-w-0 flex-1">{bodyText}</span>
          {qtyEl}
        </button>
        <button
          type="button"
          data-swipe-ignore
          aria-label={`Edit ${product.name}`}
          onClick={(e) => onEdit?.(item, e.currentTarget)}
          className="flex min-h-16 w-14 shrink-0 items-center justify-center pr-[max(4px,var(--safe-right))] text-muted active:bg-accent-soft"
        >
          <Pencil aria-hidden className="h-5 w-5" />
        </button>
      </div>
    </li>
  );
}
