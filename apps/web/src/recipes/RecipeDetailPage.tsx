import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseIngredientLines, parseMethodBlocks, type Recipe } from '@trolley/core';
import { ExternalLink, ListPlus, Pencil, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, setRecipeFavourite } from '../api';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { RecipePhoto } from './RecipeThumb';
import { RecipeToListSheet } from './RecipeToListSheet';
import { rqk, useRecipeQuery } from './data';
import { useWakeLock } from './useWakeLock';
import { ChefHat } from 'lucide-react';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xl">{title}</h2>
      {children}
    </section>
  );
}

/** Plain text with line breaks kept (never HTML). */
const Plain = ({ text }: { text: string }) => (
  <p className="whitespace-pre-line break-words text-lg leading-relaxed">{text}</p>
);

/** Recipe detail, the cooking view (docs/stages/stage-5.md E). */
export function RecipeDetailPage() {
  const { id } = useParams();
  const query = useRecipeQuery(id);
  const recipe = query.data;
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { online } = useOnlineStatus();
  const [awake, setAwake] = useState(true);
  const [sheet, setSheet] = useState(false);
  const { supported } = useWakeLock(awake && !!recipe);

  const fav = useMutation({
    mutationFn: (favourite: boolean) => setRecipeFavourite(id as string, favourite),
    onSuccess: (r) => {
      qc.setQueryData(rqk.recipe(r.id), r);
      void qc.invalidateQueries({ queryKey: rqk.recipes });
    },
    onError: () => toast.show("Couldn't update the favourite. Check your connection."),
  });

  const ingredients = useMemo(() => parseIngredientLines(recipe?.ingredients ?? ''), [recipe]);
  const method = useMemo(() => parseMethodBlocks(recipe?.instructions ?? ''), [recipe]);
  const hasIngredients = ingredients.some((l) => l.kind === 'ingredient');

  const header = (right?: React.ReactNode) => (
    <PageHeader
      title={recipe?.title ?? 'Recipe'}
      backTo="/recipes"
      backLabel="Back to Recipes"
      right={right}
    />
  );

  if (query.isPending) {
    return (
      <div>
        {header()}
        {showSkeleton && (
          <div aria-busy="true" className="space-y-3 p-4">
            <p className="sr-only">Loading recipe</p>
            <Skeleton className="h-48 w-full rounded-md" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
      </div>
    );
  }
  if (!recipe) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        {header()}
        {gone ? (
          <EmptyView
            Icon={ChefHat}
            title="Recipe not found"
            body="It may have been deleted on the other phone."
          >
            <Button onClick={() => navigate('/recipes', { replace: true })}>Back to Recipes</Button>
          </EmptyView>
        ) : (
          <ErrorView
            title="Couldn't load that recipe"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }

  const r: Recipe = recipe;
  const meta: [string, string][] = (
    [
      ['Prep', r.prepTime],
      ['Cook', r.cookTime],
      ['Total', r.totalTime],
      ['Serves', r.yield],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <div className="pb-24">
      {header(
        <>
          <button
            type="button"
            aria-label={r.favourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={r.favourite}
            disabled={fav.isPending}
            onClick={() => fav.mutate(!r.favourite)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-accent"
          >
            <Star aria-hidden className="h-6 w-6" fill={r.favourite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            aria-label="Edit recipe"
            onClick={() => navigate(`/recipes/${r.id}/edit`)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
          >
            <Pencil aria-hidden className="h-6 w-6" />
          </button>
        </>,
      )}
      {r.photoUrl && (
        <RecipePhoto src={r.photoUrl} eager className="aspect-video max-h-[40vh] w-full" />
      )}
      <article className="px-[max(16px,var(--safe-left))] pt-4">
        <h2 className="break-words text-2xl">{r.title}</h2>
        {meta.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                <dd className="text-lg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {r.categories.length > 0 && (
          <ul aria-label="Categories" className="mt-3 flex flex-wrap gap-2">
            {r.categories.map((c) => (
              <li key={c} className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
                {c}
              </li>
            ))}
          </ul>
        )}
        {supported && (
          <label className="mt-4 flex min-h-tap cursor-pointer items-center justify-between gap-3 rounded-md bg-surface px-3">
            <span className="text-base">Keep screen on</span>
            <input
              type="checkbox"
              role="switch"
              checked={awake}
              onChange={(e) => setAwake(e.target.checked)}
              className="h-11 w-12 shrink-0"
            />
          </label>
        )}
        {r.description && (
          <div className="mt-4">
            <Plain text={r.description} />
          </div>
        )}
        {ingredients.length > 0 && (
          <Section title="Ingredients">
            <ul className="space-y-2">
              {ingredients.map((l, i) =>
                l.kind === 'heading' ? (
                  <li key={i} className="pt-2">
                    <h3 className="text-lg font-bold text-accent">{l.text}</h3>
                  </li>
                ) : (
                  <li key={i} className="break-words text-lg leading-relaxed">
                    {l.text}
                  </li>
                ),
              )}
            </ul>
          </Section>
        )}
        {method.length > 0 && (
          <Section title="Method">
            <ol className="space-y-4" aria-label="Method steps">
              {method.map((b, i) =>
                b.kind === 'heading' ? (
                  <li key={i} className="pt-2">
                    <h3 className="text-lg font-bold text-accent">{b.text}</h3>
                  </li>
                ) : (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-on"
                    >
                      {b.n}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-line break-words text-lg leading-relaxed">
                      <span className="sr-only">Step {b.n}. </span>
                      {b.text}
                    </span>
                  </li>
                ),
              )}
            </ol>
          </Section>
        )}
        {r.notes && (
          <Section title="Notes">
            <Plain text={r.notes} />
          </Section>
        )}
        {r.nutrition && (
          <Section title="Nutrition">
            <Plain text={r.nutrition} />
          </Section>
        )}
        {r.sourceUrl && (
          <Section title="Source">
            <a
              href={r.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap items-center gap-2 break-all text-lg text-accent underline"
            >
              {hostOf(r.sourceUrl)}
              <ExternalLink aria-hidden className="h-5 w-5 shrink-0" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Section>
        )}
      </article>

      {hasIngredients && (
        <div className="fixed inset-x-0 bottom-[var(--nav-height)] z-20 border-t border-border-subtle bg-surface px-[max(16px,var(--safe-left))] py-3">
          <Button
            aria-disabled={!online}
            onClick={() => {
              if (!online) {
                toast.show("You're offline. Reconnect to add ingredients to a list.");
                return;
              }
              setSheet(true);
            }}
          >
            <ListPlus aria-hidden className="h-5 w-5" />
            Add to list
          </Button>
        </div>
      )}
      {sheet && <RecipeToListSheet recipe={r} onClose={() => setSheet(false)} />}
    </div>
  );
}
