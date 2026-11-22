import { Info } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastContextValue {
  show: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_MS = 4000;
const SWIPE_DISMISS_PX = 24;

/**
 * Single-message toast above the bottom nav (docs/ux/search.md 2.6). One at a time (a new
 * message replaces the old), auto-dismisses after 4 s, pauses while pressed, swipe down
 * dismisses. The wrapper is a persistent live region so screen readers announce it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(DEFAULT_MS);
  const startedAt = useRef(0);
  const dragStart = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const arm = useCallback(
    (ms: number) => {
      clear();
      remaining.current = ms;
      startedAt.current = Date.now();
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [clear],
  );

  const show = useCallback(
    (text: string, durationMs = DEFAULT_MS) => {
      setToast((t) => ({ id: (t?.id ?? 0) + 1, message: text }));
      arm(durationMs);
    },
    [arm],
  );

  useEffect(() => clear, [clear]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    remaining.current = Math.max(500, remaining.current - (Date.now() - startedAt.current));
    clear();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start !== null && e.clientY - start > SWIPE_DISMISS_PX) setToast(null);
    else arm(remaining.current);
  };

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+max(var(--safe-bottom),8px)+12px)] z-[60] flex justify-center px-4"
      >
        {toast && (
          <p
            key={toast.id}
            data-testid="toast"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="toast-enter pointer-events-auto flex min-h-12 w-full max-w-[358px] touch-none items-center gap-2 rounded-md bg-text px-4 py-3 text-base font-semibold text-bg shadow-sheet"
          >
            <Info aria-hidden className="h-5 w-5 shrink-0" />
            <span>{toast.message}</span>
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
