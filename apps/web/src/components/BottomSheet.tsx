import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  /** Id of the heading that names the dialog (aria-labelledby). */
  labelledBy: string;
  /** Header content (below the drag handle). Dragging the handle or header dismisses. */
  header: ReactNode;
  /** Scrolling middle. */
  children: ReactNode;
  /** Pinned footer (buttons). */
  footer: ReactNode;
  onClose: () => void;
  /** Element to focus on open (default: the first element with `data-sheet-initial`). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes on close (default: whatever was focused when the sheet opened). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Locks dismissal (Esc, scrim, drag) while an action runs. */
  busy?: boolean;
  /** Reports whether the visual viewport is short (keyboard open): collapse the header. */
  onCompactChange?: (compact: boolean) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DISMISS_FRACTION = 0.25;
const FLICK_PX_PER_MS = 0.6;
const COMPACT_BELOW_PX = 480;

/** Hide the rest of the page from assistive tech and the tab order while a sheet is open. */
function useInertBackground(container: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!container) return;
    const changed: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === container || el.tagName === 'SCRIPT' || el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      changed.push(el);
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      for (const el of changed) el.removeAttribute('inert');
      document.body.style.overflow = prevOverflow;
    };
  }, [container]);
}

/** Tracks the visual viewport so the sheet sits above the on-screen keyboard. */
function useVisualViewport() {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ height: vv.height, top: vv.offsetTop });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return box;
}

/**
 * Modal bottom sheet (docs/ux/app-shell.md "Sign out confirm", quantity-modal.md 7,
 * search.md 5): role=dialog, background inert, page scroll locked, focus trapped, focus
 * returns to the opener. Esc, scrim tap and dragging the handle or header down dismiss.
 */
export function BottomSheet({
  labelledBy,
  header,
  children,
  footer,
  onClose,
  initialFocusRef,
  returnFocusRef,
  busy = false,
  onCompactChange,
}: BottomSheetProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  const viewport = useVisualViewport();
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; startT: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
    };
  }, []);

  useInertBackground(container);

  useEffect(() => {
    if (!container) return;
    const target =
      initialFocusRef?.current ??
      sheet.current?.querySelector<HTMLElement>('[data-sheet-initial]') ??
      sheet.current;
    target?.focus({ preventScroll: true });
    const from = opener.current;
    return () => {
      // The ref is read lazily on purpose: the opener may have changed while open.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const back = returnFocusRef?.current ?? from;
      if (back?.isConnected) back.focus?.();
    };
    // Focus handling runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  const compact = viewport !== null && viewport.height < COMPACT_BELOW_PX;
  useEffect(() => {
    onCompactChange?.(compact);
  }, [compact, onCompactChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => !el.hasAttribute('hidden') && el.getAttribute('tabindex') !== '-1',
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    // The heading / sheet itself (tabindex -1) is not in the cycle: treat it as outside.
    const inside = active instanceof HTMLElement && items.includes(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  const onDragStart = (e: React.PointerEvent) => {
    if (busy) return;
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    drag.current = {
      startY: e.clientY,
      startT: e.timeStamp,
      height: sheet.current?.getBoundingClientRect().height ?? 400,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setDragY(Math.max(0, e.clientY - drag.current.startY));
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const velocity = dy / Math.max(1, e.timeStamp - d.startT);
    if (dy > d.height * DISMISS_FRACTION || (dy > 20 && velocity > FLICK_PX_PER_MS)) {
      setDragY(0);
      onClose();
    } else {
      setDragY(0);
    }
  };

  if (!container) return null;

  return createPortal(
    <div
      className="fixed inset-x-0 z-50 flex items-end"
      style={
        viewport ? { top: viewport.top, height: viewport.height } : { top: 0, height: '100dvh' }
      }
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="scrim"
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        onClick={() => !busy && onClose()}
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-testid="sheet"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current ? 'none' : undefined,
        }}
        className="sheet-enter relative mx-auto flex max-h-[90%] w-full max-w-[560px] flex-col rounded-t-lg bg-surface-raised shadow-sheet focus:outline-none"
      >
        <div
          className="shrink-0 touch-none px-[max(16px,var(--safe-left))]"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="flex h-6 items-center justify-center" aria-hidden>
            <div className="h-1 w-10 rounded-full bg-border-subtle" />
          </div>
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[max(16px,var(--safe-left))] pb-3 pt-1">
          {children}
        </div>
        <div className="shrink-0 space-y-3 border-t border-border-subtle px-[max(16px,var(--safe-left))] pb-[max(var(--safe-bottom),16px)] pt-3">
          {footer}
        </div>
      </div>
    </div>,
    container,
  );
}
