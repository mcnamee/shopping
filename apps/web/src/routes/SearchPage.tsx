import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DEFAULT_GROUPS, type GroupSummary, type ProductSummary } from '@trolley/core';
import { Loader2, Plus, ShoppingCart } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, getGroups, getProduct, searchProducts } from '../api';
import { useListsQuery, useTemplatesQuery } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { setLastSearch } from '../search/lastSearch';
import { CategoryChips } from '../search/CategoryChips';
import { CustomProductSheet } from '../search/CustomProductSheet';
import { useDebouncedValue, useDelayedFlag, useNearViewport } from '../search/hooks';
import { ProductCard, ProductCardSkeleton } from '../search/ProductCard';
import { QuantityModal, type QuantitySelection } from '../search/QuantityModal';
import { SearchField } from '../search/SearchField';
import { ErrorState, InitialState, NoResultsState, OfflineState } from '../search/SearchStates';
import { sessionTargets, type AddTarget } from '../search/target';
import { useAddToTarget } from '../search/useAddToTarget';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const PAGE_SIZE = 24;
const SKELETON_DELAY_MS = 150;
const ADDED_MS = 1500;

type Modal =
  | {
      kind: 'quantity';
      product: ProductSummary;
      target: AddTarget;
      startOnPicker: boolean;
      fromTemplateIcon: boolean;
    }
  | { kind: 'custom'; name: string; fromTemplateIcon: boolean }
  | null;

const FALLBACK_GROUPS: readonly GroupSummary[] = DEFAULT_GROUPS;

/** Search tab (docs/ux/search.md). State lives in the URL: /search?q=milk&cat=dairy-eggs. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { online } = useOnlineStatus();
  const addToTarget = useAddToTarget();
  const listContext = params.get('list');
  const templateContext = params.get('template');
  const listsQuery = useListsQuery();
  const templatesQuery = useTemplatesQuery();
  const lists = listsQuery.data?.lists;
  const templates = templatesQuery.data?.templates;

  const [text, setText] = useState(() => params.get('q') ?? '');
  const [committed, flush] = useDebouncedValue(text, DEBOUNCE_MS);
  const category = params.get('cat') || undefined;

  const input = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [addedSku, setAddedSku] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // Focus returns to the control that opened a sheet; if that card has since gone (a new
  // custom product re-ran the search), fall back to the search field.
  const returnFocus = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return opener.current?.isConnected ? opener.current : input.current;
      },
    }),
    [],
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: Infinity,
    retry: 1,
  });
  const groups = groupsQuery.data?.groups ?? FALLBACK_GROUPS;

  const trimmed = committed.trim();
  const activeQuery = trimmed.length >= MIN_CHARS ? trimmed : '';
  const enabled = activeQuery !== '' || category !== undefined;

  // Keep the URL in step with the committed query (replace, not push).
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) next.set('q', trimmed);
        else next.delete('q');
        return next.toString() === prev.toString() ? prev : next;
      },
      { replace: true },
    );
  }, [trimmed, setParams]);

  // The Add items context is dropped when leaving Search through the bottom nav (lists.md 3.10).
  useEffect(() => {
    const rest = new URLSearchParams(params);
    rest.delete('list');
    rest.delete('template');
    setLastSearch(rest.toString() ? `?${rest.toString()}` : '');
  }, [params]);

  const query = useInfiniteQuery({
    queryKey: ['products', 'search', activeQuery, category ?? ''],
    queryFn: ({ pageParam, signal }) =>
      searchProducts({ q: activeQuery, category, cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });

  // Back online: retry a failed first page.
  const refetch = query.refetch;
  const hadError = query.isError;
  useEffect(() => {
    if (online && hadError) void refetch();
    // Only on regaining connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // A product pinned first (from "Find {name} in Search"): fetched by id so it shows even when
  // it isn't on page 1 (and for custom products).
  const pinId = params.get('pin');
  const pinQuery = useQuery({
    queryKey: ['products', 'detail', pinId],
    queryFn: () => getProduct(pinId ?? ''),
    enabled: pinId !== null && pinId !== '',
    staleTime: 60_000,
    retry: false,
  });
  const pinned: ProductSummary | null = pinQuery.data ?? null;
  const items = useMemo(() => {
    const rest = query.data?.pages.flatMap((p) => p.items) ?? [];
    if (!pinned || pinned.sku !== pinId) return rest;
    return [pinned, ...rest.filter((p) => p.sku !== pinned.sku)];
  }, [query.data, pinned, pinId]);
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0;
  const loadingFirst = enabled && (query.isPending || query.isPlaceholderData);
  const showSkeleton = useDelayedFlag(loadingFirst, SKELETON_DELAY_MS);
  const firstPageError = query.isError && !query.isFetchNextPageError;
  const loadMoreError = query.isFetchNextPageError;
  const categoryName = groups.find((g) => g.id === category)?.name;
  const browsing = activeQuery === '' && category !== undefined;

  const fetchNext = query.fetchNextPage;
  const canLoadMore =
    enabled && !loadingFirst && query.hasNextPage && !query.isFetchingNextPage && !loadMoreError;
  const sentinel = useNearViewport(() => void fetchNext(), canLoadMore, items.length);

  const contextTarget = (): AddTarget | null => {
    if (listContext) {
      return {
        kind: 'list',
        id: listContext,
        name: lists?.find((l) => l.id === listContext)?.name ?? '',
      };
    }
    if (templateContext) {
      const t = templates?.find((x) => x.id === templateContext);
      return {
        kind: 'template',
        id: templateContext,
        name: t?.name ?? '',
        ...(t ? { type: t.type } : {}),
      };
    }
    return null;
  };

  /** A remembered target only counts while that list or template still exists. */
  const stillThere = (t: AddTarget | null): AddTarget | null => {
    if (!t) return null;
    if (t.kind === 'list' && lists && !lists.some((l) => l.id === t.id)) return null;
    if (t.kind === 'template' && templates && !templates.some((x) => x.id === t.id)) return null;
    return t;
  };

  const openQuantity = (product: ProductSummary, fromTemplateIcon: boolean) => {
    let target: AddTarget = { kind: 'thisWeek' };
    let startOnPicker = false;
    if (fromTemplateIcon) {
      const remembered = stillThere(sessionTargets.lastTemplate);
      const only = templates?.length === 1 ? templates[0] : undefined;
      const ctx = templateContext ? contextTarget() : null;
      if (ctx) target = ctx;
      else if (remembered) target = remembered;
      else if (only) target = { kind: 'template', id: only.id, name: only.name, type: only.type };
      else startOnPicker = true;
    } else {
      target = contextTarget() ?? stillThere(sessionTargets.last) ?? target;
    }
    setModal({ kind: 'quantity', product, target, startOnPicker, fromTemplateIcon });
  };

  const openCustom = (name: string, button: HTMLElement | null) => {
    opener.current = button;
    setModal({ kind: 'custom', name, fromTemplateIcon: false });
  };

  const onAdd = (product: ProductSummary, button: HTMLButtonElement) => {
    opener.current = button;
    openQuantity(product, false);
  };

  const onTemplateIcon = (product: ProductSummary, button: HTMLButtonElement) => {
    opener.current = button;
    openQuantity(product, true);
  };

  const findInSearch = (product: ProductSummary) => {
    setModal(null);
    setText(product.name);
    flush(product.name);
    setParams({ q: product.name, pin: product.sku }, { replace: true });
    window.scrollTo?.(0, 0);
  };

  const onConfirm = async (selection: QuantitySelection) => {
    if (modal?.kind !== 'quantity') return;
    const { product } = selection;
    await addToTarget(modal.target, selection);
    setModal(null);
    if (modal.target.kind !== 'template') {
      setAddedSku(product.sku);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAddedSku(null), ADDED_MS);
    }
  };

  const changeCategory = (id: string | undefined) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('cat', id);
        else next.delete('cat');
        return next;
      },
      { replace: true },
    );
    window.scrollTo?.(0, 0);
  };

  const retry = useCallback(() => {
    void query.refetch();
    resultsHeading.current?.focus();
  }, [query]);

  const unreachable = !(query.error instanceof ApiError);

  let body: React.ReactNode;
  if (!enabled) {
    body = <InitialState onCustom={(b) => openCustom('', b)} />;
  } else if (!online && !query.data) {
    body = <OfflineState online={online} hasPrevious={false} onRetry={retry} />;
  } else if (firstPageError) {
    body = <ErrorState unreachable={unreachable} onRetry={retry} />;
  } else if (loadingFirst && showSkeleton) {
    body = (
      <ul aria-busy="true" className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </ul>
    );
  } else if (query.isPending) {
    body = null;
  } else if (items.length === 0 && !query.isPlaceholderData) {
    body = (
      <NoResultsState
        query={activeQuery}
        categoryName={categoryName}
        browse={browsing}
        onCustom={(b) => openCustom(activeQuery, b)}
      />
    );
  } else {
    const endLabel = browsing
      ? `That's everything in ${categoryName ?? 'this category'}.`
      : `That's everything for '${activeQuery}'.`;
    body = (
      <div className={query.isPlaceholderData ? 'opacity-60' : ''}>
        <ul className="grid grid-cols-2 gap-3">
          {items.map((p) => (
            <ProductCard
              key={p.sku}
              product={p}
              added={addedSku === p.sku}
              onAdd={onAdd}
              onTemplate={onTemplateIcon}
            />
          ))}
        </ul>
        <div ref={sentinel} aria-hidden className="h-px" />
        {query.isFetchingNextPage && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-6 text-sm text-muted"
          >
            <Loader2 aria-hidden className="h-6 w-6 animate-spin text-accent" />
            Loading more...
          </div>
        )}
        {loadMoreError && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-danger">
            <span>Couldn't load more.</span>
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              className="min-h-tap rounded-sm px-2 font-semibold underline"
            >
              Try again
            </button>
          </div>
        )}
        {!query.hasNextPage && !query.isPlaceholderData && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <p className="text-sm text-muted">{endLabel}</p>
            <button
              type="button"
              onClick={(e) => openCustom(activeQuery, e.currentTarget)}
              className="flex min-h-primary w-full items-center justify-center gap-2 rounded-md border-2 border-accent px-4 text-lg font-semibold text-accent active:bg-accent-soft"
            >
              <Plus aria-hidden className="h-5 w-5" />
              Can't find it? Add a custom item
            </button>
          </div>
        )}
      </div>
    );
  }

  const contextList = listContext ? lists?.find((l) => l.id === listContext) : undefined;
  const contextTemplate = templateContext
    ? templates?.find((t) => t.id === templateContext)
    : undefined;
  const contextBar = listContext
    ? {
        text: `Adding to ${contextList?.name ?? 'list'}`,
        doneTo: `/lists/${encodeURIComponent(listContext)}`,
      }
    : templateContext
      ? {
          text: `Adding to template ${contextTemplate?.name ?? ''}`.trim(),
          doneTo: `/templates/${encodeURIComponent(templateContext)}`,
        }
      : null;

  const showMeta =
    enabled && !firstPageError && !loadingFirst && !query.isPending && items.length > 0;
  const metaText = browsing
    ? `${categoryName ?? 'Category'}, ${total} ${total === 1 ? 'product' : 'products'}`
    : `${total} ${total === 1 ? 'result' : 'results'}`;

  return (
    <div>
      <div
        className={`sticky top-[calc(var(--safe-top)+56px)] z-20 -mx-[max(16px,var(--safe-left))] -mt-4 space-y-2 bg-bg pb-2 ${
          contextBar ? '' : 'pt-4'
        } ${scrolled ? 'border-b border-border-subtle' : 'border-b border-transparent'}`}
      >
        {contextBar && (
          <div
            data-testid="search-context"
            className="flex min-h-12 items-center gap-2 bg-accent-soft pl-[max(16px,var(--safe-left))] pr-[max(8px,var(--safe-right))]"
          >
            <ShoppingCart aria-hidden className="h-5 w-5 shrink-0 text-accent" />
            <p className="min-w-0 flex-1 truncate text-base font-semibold">{contextBar.text}</p>
            <Link
              to={contextBar.doneTo}
              className="flex min-h-tap items-center rounded-sm px-3 text-base font-bold text-accent"
            >
              Done
            </Link>
          </div>
        )}
        <div className={contextBar ? 'space-y-2 pt-2' : 'space-y-2'}>
          <SearchField
            ref={input}
            value={text}
            onChange={(v) => {
              setText(v);
              if (pinId) {
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('pin');
                    return next;
                  },
                  { replace: true },
                );
              }
            }}
            onSubmit={() => {
              flush(text);
              input.current?.blur();
            }}
            onClear={() => {
              setText('');
              flush('');
              input.current?.focus();
            }}
          />
          <CategoryChips groups={groups} value={category} onChange={changeCategory} />
        </div>
      </div>

      <section aria-label="Search results" className="pt-3">
        <h2 ref={resultsHeading} tabIndex={-1} className="sr-only focus:outline-none">
          Search results
        </h2>
        <p aria-live="polite" className="min-h-5 pb-2 text-sm text-muted">
          {showMeta ? metaText : ''}
        </p>
        {loadingFirst && (
          <p className="sr-only" role="status">
            Searching
          </p>
        )}
        {body}
      </section>

      {modal?.kind === 'quantity' && (
        <QuantityModal
          product={modal.product}
          target={modal.target}
          onTargetChange={(target) =>
            setModal((m) => (m?.kind === 'quantity' ? { ...m, target } : m))
          }
          startOnPicker={modal.startOnPicker}
          fromTemplateIcon={modal.fromTemplateIcon}
          {...(pinId === modal.product.sku && !listContext && !templateContext
            ? {}
            : { onFindInSearch: findInSearch })}
          onConfirm={onConfirm}
          onClose={() => setModal(null)}
          returnFocusRef={returnFocus}
        />
      )}
      {modal?.kind === 'custom' && (
        <CustomProductSheet
          initialName={modal.name}
          initialGroupId={category}
          groups={groups}
          onCreated={(product) => openQuantity(product, false)}
          onUseExisting={(product) => openQuantity(product, false)}
          onClose={() => setModal(null)}
          returnFocusRef={returnFocus}
        />
      )}
    </div>
  );
}
