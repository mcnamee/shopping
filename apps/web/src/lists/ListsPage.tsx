import { useQuery } from '@tanstack/react-query';
import type { ListSummary } from '@trolley/core';
import { Check, ChevronRight, History, ListChecks, Plus, ShoppingCart, Star } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { getHistory } from '../api';
import { AppBarAction } from '../components/appBar';
import { Button } from '../components/Button';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useDelayedFlag } from '../search/hooks';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useListsQuery, useTemplatesQuery } from './data';
import { NewListSheet } from './NewListSheet';

const SKELETON_DELAY_MS = 150;

const ariaProgress = (l: ListSummary) => `${l.name}, ${l.tickedCount} of ${l.itemCount} ticked`;

function ProgressBar({ ticked, total }: { ticked: number; total: number }) {
  return (
    <div aria-hidden className="h-2 overflow-hidden rounded-full bg-border-subtle">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${total ? Math.round((ticked / total) * 100) : 0}%` }}
      />
    </div>
  );
}

/** Lists tab (docs/ux/lists.md 1): this week's card, other active lists, History link. */
export function ListsPage() {
  const query = useListsQuery();
  const templates = useTemplatesQuery();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const lists = query.data?.lists;
  const showSkeleton = useDelayedFlag(query.isPending, SKELETON_DELAY_MS);

  const empty = lists?.length === 0;
  const probe = useQuery({
    queryKey: ['history', 'probe'],
    queryFn: () => getHistory(undefined, 1),
    enabled: empty,
    staleTime: 0,
  });
  const hasHistory = (probe.data?.lists.length ?? 0) > 0;

  const openNew = () => {
    if (!online) {
      toast.show("You're offline. Reconnect to create a list.");
      return;
    }
    setCreating(true);
  };

  const thisWeek = lists?.find((l) => l.thisWeek);
  const others = (lists ?? []).filter((l) => !l.thisWeek);

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only">Loading lists</p>
        <Skeleton className="h-[110px] rounded-md" />
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
      </div>
    ) : null;
  } else if (query.isError && !lists) {
    body = (
      <ErrorView
        title="Couldn't load your lists"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (empty) {
    body = (
      <EmptyView
        Icon={ListChecks}
        title="No lists yet"
        body="Start this week's shop from scratch or from a template."
      >
        <Button onClick={openNew} aria-disabled={!online}>
          <Plus aria-hidden className="h-5 w-5" />
          New list
        </Button>
        {hasHistory && (
          <Link
            to="/lists/history"
            className="flex min-h-primary items-center justify-center rounded-md border-2 border-border text-lg"
          >
            History
          </Link>
        )}
      </EmptyView>
    );
  } else if (lists) {
    body = (
      <div className="space-y-4">
        {thisWeek ? (
          <section aria-labelledby="this-week-label">
            <h2 id="this-week-label" className="mb-2 text-xs uppercase tracking-wide text-muted">
              This week
            </h2>
            <article className="relative rounded-md bg-surface p-4 active:bg-accent-soft">
              <div className="flex items-start gap-2">
                <h3 className="min-w-0 flex-1 text-xl">
                  <Link
                    to={`/lists/${thisWeek.id}`}
                    state={{ name: thisWeek.name }}
                    aria-label={`${ariaProgress(thisWeek)}, this week`}
                    className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:rounded-md"
                  >
                    {thisWeek.name}
                  </Link>
                </h3>
                <span
                  aria-hidden
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent"
                >
                  <Star className="h-3.5 w-3.5" />
                  This week
                </span>
              </div>
              {thisWeek.itemCount === 0 ? (
                <>
                  <p className="mt-1 text-base text-muted">No items yet</p>
                  <Link
                    to={`/search?list=${thisWeek.id}`}
                    className="relative z-10 mt-3 flex min-h-primary items-center justify-center gap-2 rounded-md bg-accent text-lg text-accent-on"
                  >
                    <Plus aria-hidden className="h-5 w-5" />
                    Add items
                  </Link>
                </>
              ) : (
                <>
                  <p aria-hidden className="mt-1 text-lg font-bold tabular-nums">
                    {thisWeek.tickedCount}/{thisWeek.itemCount} ticked
                  </p>
                  <div className="mt-2">
                    <ProgressBar ticked={thisWeek.tickedCount} total={thisWeek.itemCount} />
                  </div>
                  <span
                    aria-hidden
                    className="mt-3 flex min-h-primary items-center justify-center gap-2 rounded-md bg-accent text-lg text-accent-on"
                  >
                    <ShoppingCart className="h-5 w-5" />
                    {thisWeek.tickedCount > 0 ? 'Continue shopping' : 'Start shopping'}
                  </span>
                </>
              )}
            </article>
          </section>
        ) : (
          others.length > 0 && (
            <section className="rounded-md border-2 border-dashed border-border p-4">
              <h2 className="text-lg">No list set for this week</h2>
              <p className="mt-1 text-base text-muted">
                Open a list and choose Set as this week, or start a new one.
              </p>
              <Button className="mt-3" onClick={openNew} aria-disabled={!online}>
                New list
              </Button>
            </section>
          )
        )}

        {others.length > 0 && (
          <section aria-labelledby="other-lists-label">
            <h2 id="other-lists-label" className="mb-2 text-xs uppercase tracking-wide text-muted">
              Other lists
            </h2>
            <ul className="overflow-hidden rounded-md bg-surface">
              {others.map((l) => {
                const done = l.itemCount > 0 && l.tickedCount === l.itemCount;
                return (
                  <li key={l.id} className="border-b border-border-subtle last:border-b-0">
                    <Link
                      to={`/lists/${l.id}`}
                      state={{ name: l.name }}
                      className="flex min-h-16 items-center gap-2 px-4 active:bg-accent-soft"
                    >
                      <span className="min-w-0 flex-1 truncate text-lg">{l.name}</span>
                      <span className="sr-only">
                        , {l.tickedCount} of {l.itemCount} ticked
                      </span>
                      <span
                        aria-hidden
                        className="flex items-center gap-1 text-base font-bold tabular-nums text-muted"
                      >
                        {done && <Check className="h-4 w-4 text-success" strokeWidth={3} />}
                        {l.tickedCount}/{l.itemCount}
                      </span>
                      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <Link
          to="/lists/history"
          className="flex min-h-14 items-center gap-3 rounded-md bg-surface px-4 active:bg-accent-soft"
        >
          <History aria-hidden className="h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-lg">History</span>
            <span className="block text-sm font-normal text-muted">Past shops</span>
          </span>
          <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
        </Link>
      </div>
    );
  }

  return (
    <div className={lists && !empty ? 'pb-20' : ''}>
      <AppBarAction>
        <button
          ref={newButton}
          type="button"
          aria-label="New list"
          aria-disabled={!online}
          onClick={openNew}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm"
        >
          <Plus aria-hidden className="h-6 w-6" />
        </button>
      </AppBarAction>
      {body}
      {lists && !empty && (
        <button
          type="button"
          onClick={openNew}
          aria-disabled={!online}
          className="fixed bottom-[calc(var(--nav-height)+16px)] right-[max(16px,var(--safe-right))] z-20 flex h-14 items-center gap-2 rounded-full bg-accent px-5 text-lg text-accent-on shadow-sheet active:bg-accent-strong"
        >
          <Plus aria-hidden className="h-6 w-6" />
          New list
        </button>
      )}
      {creating && lists && (
        <NewListSheet
          lists={lists}
          templates={templates.data?.templates ?? []}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
