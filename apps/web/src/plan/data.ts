import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLAN_MEALS,
  nextRuleDate,
  storeToday,
  type MealPlanEntry,
  type PlanMeal,
  type PlanOccurrence,
  type PlanRule,
} from '@trolley/core';
import { getPlan, getPlanRules } from '../api';
import { retryOnce } from '../lists/data';

export const pqk = {
  all: ['plan'] as const,
  range: (from: string, to: string) => ['plan', from, to] as const,
  /** Under 'plan' so one refresh covers the week view and the rules. */
  rules: ['plan', 'rules'] as const,
};

export function useRulesQuery() {
  return useQuery({
    queryKey: pqk.rules,
    queryFn: () => getPlanRules(),
    retry: retryOnce,
    staleTime: 0,
    refetchOnMount: 'always',
    networkMode: 'always',
  });
}

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export const weekdayLabel = (w: number) => WEEKDAY_NAMES[w - 1] ?? '';
export const FREQUENCY_OPTIONS = [
  { value: 1, label: 'Every week' },
  { value: 2, label: 'Every 2 weeks' },
  { value: 3, label: 'Every 3 weeks' },
  { value: 4, label: 'Every 4 weeks' },
] as const;
const ORDINAL = ['', '', '2nd', '3rd', '4th'];

/** "Every Friday" / "Every 2nd Thursday". */
export const everyLabel = (r: Pick<PlanRule, 'weekday' | 'everyWeeks'>) =>
  `Every ${r.everyWeeks > 1 ? `${ORDINAL[r.everyWeeks]} ` : ''}${weekdayLabel(r.weekday)}`;

/** "3 Dec" */
export const shortDate = (date: string) => fmt({ day: 'numeric', month: 'short' }).format(at(date));

/** "Every 2nd Thursday · Dinner (next 3 Dec)"; paused and ended rules say so instead. */
export function ruleSummary(r: PlanRule, today: string = storeToday()): string {
  const base = `${everyLabel(r)} · ${mealLabel(r.meal)}`;
  if (r.paused) return `${base} (paused)`;
  const next = nextRuleDate(r, today);
  if (!next) return `${base} (ended)`;
  return r.everyWeeks > 1 ? `${base} (next ${shortDate(next)})` : base;
}

/** Title of the recipe or text a rule or occurrence stands for. */
export const mealTitle = (
  m: Pick<PlanOccurrence, 'kind' | 'recipeId' | 'text'>,
  recipeTitle: string | undefined,
  gone: boolean,
) =>
  m.kind === 'text' ? (m.text ?? '') : recipeTitle ? recipeTitle : gone ? 'Recipe deleted' : '...';

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

/** Recurring occurrences on a day and meal slot. */
export const occurrencesFor = (
  occurrences: readonly PlanOccurrence[],
  date: string,
  meal: PlanMeal | null,
) => occurrences.filter((o) => o.date === date && o.meal === meal);

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
