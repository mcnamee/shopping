import { useQueryClient } from '@tanstack/react-query';
import { sortUnitOverrides, type UnitOverride, type UnitOverridesResponse } from '@trolley/core';
import { Search, Tag, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { deleteUnitOverride, saveUnitOverride } from '../api';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { qk, useUnitOverridesQuery } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { ProductImage } from '../search/ProductImage';

const FILTER_FROM = 8;

/** Settings > Remembered units (docs/ux/settings-stage2.md 3). */
export function UnitsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const query = useUnitOverridesQuery();
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const [filter, setFilter] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  const all = sortUnitOverrides(query.data?.overrides ?? []);
  const q = filter.trim().toLowerCase();
  const rows = q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;

  const setCache = (overrides: UnitOverride[]) =>
    qc.setQueryData<UnitOverridesResponse>(qk.units, { overrides });

  const forget = async (o: UnitOverride, index: number) => {
    if (!online) {
      toast.show("You're offline. Reconnect to change this.");
      return;
    }
    const before = query.data?.overrides ?? [];
    const after = before.filter((x) => x.productId !== o.productId);
    setCache(after);
    setAnnouncement(`${o.name} forgotten. ${after.length} remaining.`);
    requestAnimationFrame(() => {
      const next = rows.filter((r) => r.productId !== o.productId)[index];
      const el = next
        ? document.querySelector<HTMLElement>(`[data-forget="${CSS.escape(next.productId)}"]`)
        : null;
      (el ?? heading.current)?.focus();
    });
    try {
      await deleteUnitOverride(o.productId);
      void qc.invalidateQueries({ queryKey: ['products'] });
      toast.show(`${o.name} will open in ${o.defaultUnit} again`, {
        durationMs: 5000,
        action: {
          label: 'Undo',
          onAction: () => {
            saveUnitOverride(o.productId, o.unit).then(
              () => void qc.invalidateQueries({ queryKey: qk.units }),
              () => toast.show("Couldn't save. Check your connection."),
            );
          },
        },
      });
    } catch {
      setCache(before);
      toast.show("Couldn't save. Check your connection.");
    }
  };

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-2">
        <p className="sr-only">Loading remembered units</p>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (query.isError && !query.data) {
    body = (
      <ErrorView
        title="Couldn't load remembered units"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (all.length === 0) {
    body = (
      <EmptyView
        Icon={Tag}
        headingRef={heading}
        title="No remembered units"
        body="When you pick a different unit in the quantity box and tick Remember, it shows up here."
      />
    );
  } else {
    body = (
      <>
        {all.length >= FILTER_FROM && (
          <div className="relative mb-3">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Filter remembered units"
              placeholder="Filter products"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-h-primary w-full rounded-md border-2 border-border bg-surface pl-10 pr-3 text-lg focus:border-accent"
            />
          </div>
        )}
        {rows.length === 0 ? (
          <p className="py-4 text-base text-muted">No matches for '{filter.trim()}'.</p>
        ) : (
          <ul className="overflow-hidden rounded-md bg-surface">
            {rows.map((o, i) => (
              <li
                key={o.productId}
                className="flex min-h-[72px] items-center gap-3 border-b border-border-subtle py-2 pl-3 pr-1 last:border-b-0"
              >
                <ProductImage
                  src={o.imageUrl}
                  name={o.name}
                  padding="p-1"
                  className="h-12 w-12 shrink-0 rounded-sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-lg font-semibold">{o.name}</p>
                  <p className="text-sm text-muted">
                    Opens in {o.unit} (usually {o.defaultUnit})
                  </p>
                </div>
                <button
                  type="button"
                  data-forget={o.productId}
                  aria-label={`Forget ${o.unit} for ${o.name}`}
                  aria-disabled={!online}
                  onClick={() => void forget(o, i)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-muted active:bg-accent-soft"
                >
                  <Trash2 aria-hidden className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Remembered units" backTo="/settings" backLabel="Back to settings" />
      <main className="px-[max(16px,var(--safe-left))] pb-4 pt-4">
        <p className="mb-3 text-base text-muted">
          Trolley opens these products in the unit you chose last time.
        </p>
        {body}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </main>
    </div>
  );
}
