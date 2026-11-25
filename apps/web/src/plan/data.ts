import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_MEALS, type MealPlanEntry, type PlanMeal } from '@trolley/core';
import { getPlan } from '../api';
import { retryOnce } from '../lists/data';

export const pqk = {
  all: ['plan'] as const,
  range: (from: string, to: string) => ['plan', from, to] as const,
};

// The plan is online-only, like recipes (D-110).
export function usePlanQuery(from: string, to: string) {
  return useQuery({
    queryKey: pqk.range(from, to),
    queryFn: () => getPlan(from, to),
    retry: retryOnce,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    networkMode: 'always',
  });
}

export const useRefreshPlan = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: pqk.all });
};

export const MEAL_LABELS: Record<PlanMeal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};
export const mealLabel = (m: PlanMeal | null) => (m ? MEAL_LABELS[m] : 'Other');
export const MEAL_OPTIONS: Array<{ value: PlanMeal | null; label: string }> = [
  ...PLAN_MEALS.map((m) => ({ value: m as PlanMeal | null, label: MEAL_LABELS[m] })),
  { value: null, label: 'None' },
];

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...opts });
const at = (date: string) => new Date(`${date}T00:00:00Z`);
/** "Mon 23 Nov" */
export const dayLabel = (date: string) =>
  fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(at(date)).replace(',', '');
/** "Monday" */
export const weekdayName = (date: string) => fmt({ weekday: 'long' }).format(at(date));
/** "Wed 25 Nov - Tue 1 Dec" */
export const rangeLabel = (first: string, last: string) => `${dayLabel(first)} - ${dayLabel(last)}`;

/** Entries on a day, grouped for display. */
export const entriesFor = (
  entries: readonly MealPlanEntry[],
  date: string,
  meal: PlanMeal | null,
) => entries.filter((e) => e.date === date && e.meal === meal);

const VIEW_KEY = 'trolley.recipes.view';
export type RecipesView = 'recipes' | 'plan';
export function loadView(): RecipesView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'plan' ? 'plan' : 'recipes';
  } catch {
    return 'recipes';
  }
}
export function saveView(v: RecipesView): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private mode etc.: the choice just is not remembered */
  }
}
