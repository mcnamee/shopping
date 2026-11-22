import type { ListSummary } from '@trolley/core';
import { ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useDelayedFlag } from '../search/hooks';
import { useHistoryQuery } from './data';
import { longDay, monthLabel, shortDay } from './format';

/** /lists/history (docs/ux/lists.md 4.1): archived lists newest first, grouped by month. */
export function HistoryPage() {
  const query = useHistoryQuery();
  const skeleton = useDelayedFlag(query.isPending, 150);
  const lists = query.data?.pages.flatMap((p) => p.lists) ?? [];

  const months: { label: string; lists: ListSummary[] }[] = [];
  for (const l of lists) {
    const label = monthLabel(l.completedAt ?? l.updatedAt);
    const last = months[months.length - 1];
    if (last?.label === label) last.lists.push(l);
    else months.push({ label, lists: [l] });
  }

  let body: React.ReactNode;
  if (query.isPending) {
    body = skeleton ? (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only">Loading history</p>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (query.isError && lists.length === 0) {
    body = (
      <ErrorView
        title="Couldn't load your history"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (lists.length === 0) {
    body = (
      <EmptyView
        Icon={History}
        title="No past shops yet"
        body="Finished lists show up here so you can look back at what you bought."
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        {months.map((m) => (
          <section key={m.label} aria-label={m.label}>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">{m.label}</h2>
            <ul className="overflow-hidden rounded-md bg-surface">
              {m.lists.map((l) => {
                const at = l.completedAt ?? l.updatedAt;
                return (
                  <li key={l.id} className="border-b border-border-subtle last:border-b-0">
                    <Link
                      to={`/lists/${l.id}`}
                      state={{ name: l.name, from: 'history' }}
                      className="flex min-h-[72px] items-center gap-2 px-4 active:bg-accent-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg">{l.name}</span>
                        <span aria-hidden className="block text-sm font-normal text-muted">
                          {shortDay(at)} · {l.tickedCount}/{l.itemCount} bought
                        </span>
                        <span className="sr-only">
                          , finished {longDay(at)}, {l.tickedCount} of {l.itemCount} bought
                        </span>
                      </span>
                      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {query.isFetchNextPageError && (
          <p className="flex items-center justify-center gap-2 text-sm text-danger">
            Couldn't load more.
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              className="min-h-tap rounded-sm px-2 font-semibold underline"
            >
              Try again
            </button>
          </p>
        )}
        {query.hasNextPage && !query.isFetchNextPageError && (
          <Button
            variant="secondary"
            busy={query.isFetchingNextPage}
            busyLabel="Loading..."
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="History" backTo="/" backLabel="Back to lists" />
      <main className="px-[max(16px,var(--safe-left))] pb-4 pt-4">{body}</main>
    </div>
  );
}
