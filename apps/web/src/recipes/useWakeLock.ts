import { useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', cb: () => void) => void;
}
type WakeLockNav = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export const wakeLockSupported = () =>
  typeof navigator !== 'undefined' && !!(navigator as WakeLockNav).wakeLock;

/**
 * Keep the screen on while `enabled` (D-109): acquired now, re-acquired when the page becomes
 * visible again (the browser drops it when hidden), released on leave or when turned off.
 */
export function useWakeLock(enabled: boolean): { supported: boolean } {
  const [supported] = useState(wakeLockSupported);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!supported || !enabled) return;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel.current) return;
      try {
        const s = await (navigator as WakeLockNav).wakeLock?.request('screen');
        if (!s) return;
        if (cancelled) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel.current = s;
        s.addEventListener?.('release', () => {
          if (sentinel.current === s) sentinel.current = null;
        });
      } catch {
        // Denied (low battery, not allowed): carry on without it.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel.current;
      sentinel.current = null;
      if (s) void s.release().catch(() => undefined);
    };
  }, [supported, enabled]);

  return { supported };
}
