import type { ListItem } from '@trolley/core';
import { useEffect, useReducer, useRef, useState } from 'react';

/** Re-renders every `ms` (the "Updated 30 s ago" label). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const SINK_DELAY_MS = 500;

/**
 * Sink animation timing (docs/ux/lists.md 3.4): a ticked row greys at once but keeps its place
 * for 500 ms before it moves to the bottom of its group, so a mis-tap can be undone without the
 * row moving. Reorders wait while a finger is down. Returns `ticked` values to sort by.
 */
export function useSettledTicks(
  items: readonly ListItem[],
  enabled: boolean,
): Map<string, boolean> {
  const settled = useRef(new Map<string, boolean>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latest = useRef(items);
  latest.current = items;
  const touching = useRef(false);
  const waiting = useRef(new Set<string>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const ids = new Set(items.map((i) => i.id));
  for (const i of items)
    if (!enabled || !settled.current.has(i.id)) settled.current.set(i.id, i.ticked);
  for (const id of settled.current.keys()) if (!ids.has(id)) settled.current.delete(id);

  const apply = (id: string) => {
    const item = latest.current.find((i) => i.id === id);
    if (item) settled.current.set(id, item.ticked);
    rerender();
  };

  useEffect(() => {
    if (!enabled) return;
    for (const i of items) {
      const pending = timers.current.get(i.id);
      if (settled.current.get(i.id) === i.ticked) {
        if (pending) {
          clearTimeout(pending);
          timers.current.delete(i.id);
        }
        waiting.current.delete(i.id);
      } else if (!pending && !waiting.current.has(i.id)) {
        timers.current.set(
          i.id,
          setTimeout(() => {
            timers.current.delete(i.id);
            if (touching.current) waiting.current.add(i.id);
            else apply(i.id);
          }, SINK_DELAY_MS),
        );
      }
    }
  });

  useEffect(() => {
    const down = () => (touching.current = true);
    const up = () => {
      touching.current = false;
      if (waiting.current.size) {
        for (const id of waiting.current)
          settled.current.set(id, latest.current.find((i) => i.id === id)?.ticked ?? false);
        waiting.current.clear();
        rerender();
      }
    };
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    const pending = timers.current;
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      for (const t of pending.values()) clearTimeout(t);
    };
  }, []);

  return settled.current;
}
