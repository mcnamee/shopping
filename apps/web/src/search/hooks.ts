import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Debounced copy of `value`. `flush(next)` applies a value immediately (keyboard Search
 * key, clear button) and cancels the pending debounce.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): [T, (next?: T) => void] {
  const [debounced, setDebounced] = useState(value);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  const flush = useCallback(
    (next?: T) => setDebounced(next === undefined ? latest.current : next),
    [],
  );
  return [debounced, flush];
}

/** True once `active` has been true for `delayMs` (avoids flashing skeletons). */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return on;
}

/** Calls `onVisible` when the element comes within `marginPx` of the viewport. */
export function useNearViewport(
  onVisible: () => void,
  enabled: boolean,
  /** Changes after each page loads so a still-visible sentinel triggers again. */
  resetKey: unknown,
  marginPx = 400,
): (el: HTMLElement | null) => void {
  const cb = useRef(onVisible);
  cb.current = onVisible;
  const observer = useRef<IntersectionObserver | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: `0px 0px ${marginPx}px 0px` },
    );
    io.observe(el);
    observer.current = io;
    return () => io.disconnect();
  }, [el, enabled, resetKey, marginPx]);

  return setEl;
}
