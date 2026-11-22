import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  DEFAULT_AISLE_ORDER,
  normaliseAisleOrder,
  sortActiveLists,
  type ListDetail,
  type ListSummary,
  type ListsResponse,
} from '@trolley/core';
import {
  ApiError,
  getAisleOrder,
  getHistory,
  getList,
  getLists,
  getTemplate,
  getTemplates,
  getUnitOverrides,
} from '../api';

/** TanStack Query keys for everything Stage 2 reads. */
export const qk = {
  lists: ['lists'] as const,
  list: (id: string) => ['list', id] as const,
  history: ['history'] as const,
  templates: ['templates'] as const,
  template: (id: string) => ['template', id] as const,
  aisle: ['aisle-order'] as const,
  units: ['unit-overrides'] as const,
};

export const POLL_MS = 10_000;

/** Errors that mean "retrying will not help" (4xx) skip the automatic retry. */
export const retryOnce = (count: number, err: unknown) =>
  !(err instanceof ApiError && err.status < 500) && count < 1;

export function isStale(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    (err.body as { reason?: string } | null)?.reason === 'STALE'
  );
}

export function conflictReason(err: unknown): string | null {
  return err instanceof ApiError && err.status === 409
    ? ((err.body as { reason?: string } | null)?.reason ?? null)
    : null;
}

// ------------------------------------------------------------------ GET /lists lag (D-057)
// The lists index is eventually consistent (about 1 s). Our own recent changes are overlaid
// on whatever it returns so a list we just created, renamed, archived or deleted never
// flickers back to its old state.

const OVERLAY_MS = 4000;
const overlay = new Map<string, { at: number; summary: ListSummary | null }>();

/** Remember a list summary we just wrote (create, rename, flag, archive, reopen). */
export function noteList(summary: ListSummary): void {
  overlay.set(summary.id, { at: Date.now(), summary });
}

/** Remember that a list is gone from the active set (deleted). */
export function noteListGone(id: string): void {
  overlay.set(id, { at: Date.now(), summary: null });
}

export function clearListOverlay(): void {
  overlay.clear();
}

export function mergeOverlay(lists: readonly ListSummary[], now = Date.now()): ListSummary[] {
  let out = [...lists];
  for (const [id, o] of overlay) {
    if (now - o.at > OVERLAY_MS) {
      overlay.delete(id);
      continue;
    }
    const known = out.some((l) => l.id === id);
    if (o.summary === null || o.summary.status !== 'active') {
      out = out.filter((l) => l.id !== id);
    } else if (known) {
      const s = o.summary;
      out = out.map((l) =>
        l.id === id ? { ...l, name: s.name, thisWeek: s.thisWeek, version: s.version } : l,
      );
    } else {
      out.push(o.summary);
    }
    if (o.summary?.status === 'active' && o.summary.thisWeek) {
      out = out.map((l) => (l.id === id || !l.thisWeek ? l : { ...l, thisWeek: false }));
    }
  }
  return sortActiveLists(out);
}

export async function fetchLists(): Promise<ListsResponse> {
  const res = await getLists();
  return { lists: mergeOverlay(res.lists) };
}

// ------------------------------------------------------------------ queries

// networkMode 'always': offline requests fail (and show the error states, I2) instead of pausing.
const fresh = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  networkMode: 'always',
} as const;

export function useListsQuery(enabled = true) {
  return useQuery({
    queryKey: qk.lists,
    queryFn: fetchLists,
    enabled,
    retry: retryOnce,
    ...fresh,
  });
}

export function useTemplatesQuery(enabled = true) {
  return useQuery({
    queryKey: qk.templates,
    queryFn: getTemplates,
    enabled,
    retry: retryOnce,
    ...fresh,
  });
}

export function useTemplateQuery(id: string | undefined) {
  return useQuery({
    queryKey: qk.template(id ?? ''),
    queryFn: () => getTemplate(id as string),
    enabled: !!id,
    retry: retryOnce,
    ...fresh,
  });
}

export function useAisleOrderQuery(poll = false) {
  return useQuery({
    queryKey: qk.aisle,
    queryFn: getAisleOrder,
    retry: retryOnce,
    ...fresh,
    ...(poll ? { refetchInterval: POLL_MS } : {}),
  });
}

/** Household aisle order as group ids (ALDI order until it loads). */
export function useAisleOrder(poll = false): string[] {
  const q = useAisleOrderQuery(poll);
  return q.data ? normaliseAisleOrder(q.data.groups.map((g) => g.id)) : [...DEFAULT_AISLE_ORDER];
}

export function useUnitOverridesQuery() {
  return useQuery({ queryKey: qk.units, queryFn: getUnitOverrides, retry: retryOnce, ...fresh });
}

/**
 * One list (shop mode or archived). Polls every 10 s while `poll` is true, the tab is
 * visible and no mutation or sheet is in the way (docs/ux/lists.md 3.8, H1).
 */
export function useListQuery(id: string | undefined, shouldPoll: () => boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.list(id ?? ''),
    queryFn: ({ signal }) => getList(id as string, signal),
    enabled: !!id,
    retry: retryOnce,
    ...fresh,
    refetchInterval: () => (shouldPoll() && qc.isMutating() === 0 ? POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

export function useHistoryQuery() {
  return useInfiniteQuery({
    queryKey: qk.history,
    queryFn: ({ pageParam }) => getHistory(pageParam, 20),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: retryOnce,
    placeholderData: keepPreviousData,
    ...fresh,
  });
}

// ------------------------------------------------------------------ cache helpers

/** Patch one list's summary in the active lists cache. */
export function patchListSummary(
  qc: QueryClient,
  id: string,
  patch: (l: ListSummary) => ListSummary,
): void {
  qc.setQueryData<ListsResponse>(qk.lists, (old) =>
    old ? { lists: old.lists.map((l) => (l.id === id ? patch(l) : l)) } : old,
  );
}

/** Add or replace a list summary in the active lists cache (optimistic create). */
export function upsertListSummary(qc: QueryClient, summary: ListSummary): void {
  noteList(summary);
  qc.setQueryData<ListsResponse>(qk.lists, (old) => {
    const rest = (old?.lists ?? []).filter((l) => l.id !== summary.id);
    const next = summary.thisWeek ? rest.map((l) => ({ ...l, thisWeek: false })) : rest;
    return { lists: sortActiveLists([...next, summary]) };
  });
}

export function summaryOf(list: ListDetail | ListSummary): ListSummary {
  const { id, name, status, thisWeek, itemCount, tickedCount } = list;
  return {
    id,
    name,
    status,
    thisWeek,
    itemCount,
    tickedCount,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    completedAt: list.completedAt,
    finishedBy: list.finishedBy,
    version: list.version,
  };
}

export const ROLLBACK_MESSAGE = "Couldn't save. Check your connection.";
export const STALE_MESSAGE = 'Changed on another phone - showing latest';
