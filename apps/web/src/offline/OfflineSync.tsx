import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { updateListItem } from '../api';
import { useToast } from '../components/Toast';
import { qk } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { replayTicks, useTickQueue } from './tickQueue';

const RETRY_MS = 15_000;

export const droppedMessage = (n: number) =>
  n === 1
    ? "1 tick couldn't sync because its list or item was removed."
    : `${n} ticks couldn't sync because their lists or items were removed.`;

/** Replays queued ticks whenever the phone is online (on reconnect, on load, and every 15 s). */
export function OfflineSync() {
  const { online } = useOnlineStatus();
  const waiting = useTickQueue().length > 0;
  const qc = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!online || !waiting) return;
    const run = async () => {
      const r = await replayTicks((t) => updateListItem(t.listId, t.itemId, { ticked: t.ticked }));
      if (r.sent + r.dropped === 0) return;
      for (const id of r.lists) void qc.invalidateQueries({ queryKey: qk.list(id) });
      void qc.invalidateQueries({ queryKey: qk.lists });
      void qc.invalidateQueries({ queryKey: qk.history });
      if (r.dropped > 0) toastRef.current.show(droppedMessage(r.dropped));
      else if (!r.stopped) toastRef.current.show('Ticks synced');
    };
    void run();
    const t = setInterval(() => void run(), RETRY_MS);
    return () => {
      clearInterval(t);
    };
  }, [online, waiting, qc]);

  return null;
}
