import { useQuery } from '@tanstack/react-query';
import { getRecipe, getRecipes } from '../api';
import { retryOnce } from '../lists/data';

export const rqk = {
  recipes: ['recipes'] as const,
  recipe: (id: string) => ['recipe', id] as const,
};

// Recipes are online-only (D-110): offline requests fail and show the error state.
const fresh = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  networkMode: 'always',
} as const;

export function useRecipesQuery() {
  return useQuery({
    queryKey: rqk.recipes,
    queryFn: () => getRecipes(),
    retry: retryOnce,
    ...fresh,
  });
}

export function useRecipeQuery(id: string | undefined) {
  return useQuery({
    queryKey: rqk.recipe(id ?? ''),
    queryFn: () => getRecipe(id as string),
    enabled: !!id,
    retry: retryOnce,
    ...fresh,
  });
}

/** "45 min · Serves 4" meta line for cards. */
export const recipeMeta = (r: { totalTime: string; yield: string }) =>
  [r.totalTime, r.yield].filter(Boolean).join(' · ');
