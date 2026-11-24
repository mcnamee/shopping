import { filterRecipes, type RecipeSummary } from '@trolley/core';
import { ChefHat, Plus, Search, Star, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AppBarAction } from '../components/appBar';
import { Button } from '../components/Button';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { RecipeThumbCard } from './RecipeCard';
import { useRecipesQuery } from './data';

/** Recipes tab (docs/stages/stage-5.md C): search, chips, 2-column cards. */
export function RecipesPage() {
  const query = useRecipesQuery();
  const navigate = useNavigate();
  const { online } = useOnlineStatus();
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [favourite, setFavourite] = useState(false);
  const all = query.data?.recipes;

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of all ?? []) {
      for (const c of r.categories) if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en-AU', { sensitivity: 'base' }));
  }, [all]);

  const shown: RecipeSummary[] = useMemo(
    () => filterRecipes(all ?? [], { q, category, favourite }),
    [all, q, category, favourite],
  );

  const clear = () => {
    setQ('');
    setCategory(undefined);
    setFavourite(false);
  };
  const add = () => navigate('/recipes/new');

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="grid grid-cols-2 gap-3">
        <p className="sr-only">Loading recipes</p>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (query.isError && !all) {
    body = !online ? (
      <EmptyView
        Icon={ChefHat}
        title="You're offline"
        body="Recipes need a connection. Reconnect and try again."
      >
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </EmptyView>
    ) : (
      <ErrorView
        title="Couldn't load your recipes"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (all?.length === 0) {
    body = (
      <EmptyView
        Icon={ChefHat}
        title="No recipes yet"
        body="Add your favourite recipes and send ingredients to your list."
      >
        <Button onClick={add}>
          <Plus aria-hidden className="h-5 w-5" />
          Add recipe
        </Button>
      </EmptyView>
    );
  } else {
    body = (
      <>
        <form
          role="search"
          className="sticky top-[calc(var(--safe-top)+56px)] z-10 -mx-4 bg-bg px-4 pb-2 pt-1"
          onSubmit={(e) => e.preventDefault()}
        >
          <label htmlFor="recipe-search" className="sr-only">
            Search recipes
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-6 w-6 -translate-y-1/2 text-muted"
            />
            <input
              id="recipe-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search recipes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="block min-h-primary w-full appearance-none rounded-md border-2 border-border bg-surface pl-12 pr-12 text-base text-text placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQ('')}
                className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-sm text-muted"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            )}
          </div>
        </form>
        <div
          role="group"
          aria-label="Filter recipes"
          className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1"
        >
          <button
            type="button"
            aria-pressed={favourite}
            onClick={() => setFavourite((f) => !f)}
            className={`flex min-h-tap shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 px-4 text-base font-semibold ${
              favourite
                ? 'border-accent bg-accent text-accent-on'
                : 'border-border bg-surface text-text'
            }`}
          >
            <Star aria-hidden className="h-4 w-4" fill={favourite ? 'currentColor' : 'none'} />
            Favourites
          </button>
          {categories.map((c) => {
            const on = category?.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(on ? undefined : c)}
                className={`min-h-tap shrink-0 whitespace-nowrap rounded-full border-2 px-4 text-base font-semibold ${
                  on
                    ? 'border-accent bg-accent text-accent-on'
                    : 'border-border bg-surface text-text'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
        {shown.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-lg">No recipes match</p>
            <Button className="mt-4" variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          </div>
        ) : (
          <ul aria-label="Recipes" className="grid grid-cols-2 gap-3">
            {shown.map((r) => (
              <li key={r.id}>
                <RecipeThumbCard recipe={r} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div>
      <AppBarAction>
        <Link
          to="/recipes/new"
          aria-label="Add recipe"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm"
        >
          <Plus aria-hidden className="h-6 w-6" />
        </Link>
      </AppBarAction>
      {body}
    </div>
  );
}
