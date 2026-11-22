import { useEffect, useState } from 'react';

/** `online` tracks navigator.onLine; `justReconnected` is true for 3s after coming back. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const goOnline = () => {
      setOnline(true);
      setJustReconnected(true);
      timer = setTimeout(() => setJustReconnected(false), 3000);
    };
    const goOffline = () => {
      if (timer) clearTimeout(timer);
      setOnline(false);
      setJustReconnected(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { online, justReconnected };
}
