import { dehydrate, hydrate, type Query, type QueryClient } from '@tanstack/react-query';
import type { AuthUser } from '../auth/types';

/**
 * Offline read cache (B-006, D-102): the lists, list detail and household settings queries are
 * mirrored to localStorage so a list opened before is readable offline and on a cold start.
 * Everything is try/catch: storage can be missing, full or blocked, and the app works without it.
 * The cache is keyed to the signed-in user and wiped on sign-out.
 */
export const CACHE_KEY = 'trolley.offline.cache.v1';
export const USER_KEY = 'trolley.offline.user.v1';
export const TICKS_KEY = 'trolley.offline.ticks.v1';
/** Serialised cache cap (localStorage is ~5 MB per origin shared with everything else). */
export const MAX_CACHE_BYTES = 1_500_000;
export const MAX_CACHED_LISTS = 12;
/** Hydrated queries must outlive the default 5 minute GC, or an unvisited list would be dropped. */
export const CACHE_GC_MS = 24 * 60 * 60 * 1000;

const PERSISTED_ROOTS = new Set([
  'lists',
  'list',
  'aisle-order',
  'unit-overrides',
  'templates',
  'me',
]);

interface Stored {
  v: 1;
  userId: string;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const shouldPersist = (q: Query) =>
  q.state.status === 'success' && PERSISTED_ROOTS.has(String(q.queryKey[0]));

/** Dehydrated state for the user, newest lists first, trimmed to fit the size cap. */
export function serialiseCache(qc: QueryClient, userId: string, now = Date.now()): string {
  const state = dehydrate(qc, { shouldDehydrateQuery: shouldPersist });
  const isList = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'list';
  const lists = state.queries
    .filter(isList)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const drop = new Set(lists.slice(MAX_CACHED_LISTS));
  const build = () =>
    JSON.stringify({
      v: 1,
      userId,
      savedAt: now,
      state: { ...state, queries: state.queries.filter((q) => !drop.has(q)) },
    } satisfies Stored);
  let json = build();
  // Still too big: drop the oldest list details one at a time.
  for (
    let i = Math.min(lists.length, MAX_CACHED_LISTS) - 1;
    json.length > MAX_CACHE_BYTES && i >= 0;
    i--
  ) {
    const l = lists[i];
    if (l) drop.add(l);
    json = build();
  }
  return json;
}

export function saveCache(qc: QueryClient, userId: string): void {
  try {
    const json = serialiseCache(qc, userId);
    if (json.length <= MAX_CACHE_BYTES) store()?.setItem(CACHE_KEY, json);
  } catch {
    // Quota exceeded or storage blocked: stay online-only.
  }
}

/** Hydrate the query cache from storage. True when at least one list query came back. */
export function restoreCache(qc: QueryClient, userId: string): boolean {
  try {
    const raw = store()?.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.v !== 1 || parsed.userId !== userId || !parsed.state) return false;
    hydrate(qc, parsed.state);
    return parsed.state.queries.some((q) => q.queryKey[0] === 'lists');
  } catch {
    return false;
  }
}

/** True when a cached lists response exists for this user (without hydrating). */
export function hasCachedLists(userId: string): boolean {
  try {
    const raw = store()?.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return (
      parsed.v === 1 &&
      parsed.userId === userId &&
      !!parsed.state?.queries.some((q) => q.queryKey[0] === 'lists')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- persisted session (B-001)

export function savePersistedUser(user: AuthUser): void {
  try {
    store()?.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function readPersistedUser(): AuthUser | null {
  try {
    const raw = store()?.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<AuthUser>;
    return u.userId && u.email
      ? { userId: u.userId, email: u.email, householdId: u.householdId ?? null }
      : null;
  } catch {
    return null;
  }
}

/** Sign-out or a genuinely dead session: forget the user, the cached data and queued ticks. */
export function clearOfflineData(): void {
  for (const k of [CACHE_KEY, USER_KEY, TICKS_KEY]) {
    try {
      store()?.removeItem(k);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------- writer

let activeUserId: string | null = null;

/** Set by AuthProvider: saving only happens while a user is signed in. */
export function setPersistUser(userId: string | null): void {
  activeUserId = userId;
}

/**
 * Save the cache (debounced) whenever it changes, and when the page is hidden. Returns a
 * disposer.
 */
export function startCachePersistence(qc: QueryClient, delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (activeUserId) saveCache(qc, activeUserId);
  };
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'added' && event.type !== 'removed') return;
    if (!activeUserId || timer) return;
    timer = setTimeout(flush, delayMs);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    if (timer) clearTimeout(timer);
  };
}
