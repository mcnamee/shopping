import type { RecipeSummary } from '@trolley/core';
import { Star } from 'lucide-react';
import { Link } from 'react-router';
import { RecipePhoto } from './RecipeThumb';
import { recipeMeta } from './data';

/** Grid card: 1:1 thumb, title (2 lines), meta, star when favourite. */
export function RecipeThumbCard({ recipe: r }: { recipe: RecipeSummary }) {
  const meta = recipeMeta(r);
  return (
    <Link
      to={`/recipes/${r.id}`}
      className="block overflow-hidden rounded-md border border-border-subtle bg-surface active:bg-accent-soft"
    >
      <div className="relative">
        <RecipePhoto src={r.thumbUrl} className="aspect-square w-full" />
        {r.favourite && (
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-accent">
            <Star aria-hidden className="h-4 w-4" fill="currentColor" />
            <span className="sr-only">Favourite</span>
          </span>
        )}
      </div>
      <div className="p-3">
        <span className="line-clamp-2 break-words text-base font-semibold">{r.title}</span>
        {meta && <span className="mt-1 block text-sm font-normal text-muted">{meta}</span>}
      </div>
    </Link>
  );
}
