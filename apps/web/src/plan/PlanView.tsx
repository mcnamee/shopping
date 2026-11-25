import {
  addDays,
  PLAN_MEALS,
  storeToday,
  weekDates,
  weekStart,
  type MealPlanEntry,
  type PlanMeal,
  type RecipeSummary,
} from '@trolley/core';
import { CalendarDays, ChevronLeft, ChevronRight, ListPlus, Plus, Utensils } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { RecipePhoto } from '../recipes/RecipeThumb';
import { useRecipesQuery } from '../recipes/data';
import { AddToPlanSheet } from './AddToPlanSheet';
import { EntrySheet } from './EntrySheet';
import { PlanIngredientsSheet } from './PlanIngredientsSheet';
import { MEAL_LABELS, dayLabel, entriesFor, usePlanQuery, weekLabel, weekdayName } from './data';

type AddTarget = { date: string; meal: PlanMeal | null };

/** The Plan view of the Recipes tab (docs/stages/stage-6.md B): a Monday-Sunday week. */
export function PlanView() {
  const today = storeToday();
  const [monday, setMonday] = useState(() => weekStart(today));
  const days = useMemo(() => weekDates(monday), [monday]);
  const sunday = days[6] as string;
  const plan = usePlanQuery(monday, sunday);
  const recipes = useRecipesQuery();
  const { online } = useOnlineStatus();
  const toast = useToast();
  const showSkeleton = useDelayedFlag(plan.isPending, 150);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [open, setOpen] = useState<MealPlanEntry | null>(null);
  const [shopFor, setShopFor] = useState<{ title: string; dates: string[] } | null>(null);

  const byId = useMemo(
    () => new Map((recipes.data?.recipes ?? []).map((r) => [r.id, r] as const)),
    [recipes.data],
  );
  const entries = plan.data?.entries ?? [];
  const liveRecipeIds = (dates: readonly string[]) => [
    ...new Set(
      entries
        .filter((e) => e.kind === 'recipe' && dates.includes(e.date) && byId.has(e.recipeId ?? ''))
        .map((e) => e.recipeId as string),
    ),
  ];
  const isThisWeek = monday === weekStart(today);

  const shop = (title: string, dates: string[]) => {
    if (!online) {
      toast.show("You're offline. Reconnect to add ingredients to a list.");
      return;
    }
    setShopFor({ title, dates });
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setMonday(addDays(monday, -7))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
        >
          <ChevronLeft aria-hidden className="h-6 w-6" />
        </button>
        <h2 className="min-w-0 flex-1 text-center text-lg" aria-live="polite">
          <span className="sr-only">Week of </span>
          {weekLabel(monday, sunday)}
        </h2>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setMonday(addDays(monday, 7))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
        >
          <ChevronRight aria-hidden className="h-6 w-6" />
        </button>
      </div>
      {!isThisWeek && (
        <button
          type="button"
          onClick={() => setMonday(weekStart(today))}
          className="mx-auto mb-3 flex min-h-tap items-center gap-1 rounded-full bg-accent-soft px-4 text-base font-semibold text-accent"
        >
          <CalendarDays aria-hidden className="h-5 w-5" />
          This week
        </button>
      )}

      {plan.isPending ? (
        showSkeleton ? (
          <div aria-busy="true" className="space-y-3">
            <p className="sr-only">Loading the plan</p>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        ) : null
      ) : plan.isError && !plan.data ? (
        <ErrorView
          title="Couldn't load the plan"
          error={plan.error}
          onRetry={() => void plan.refetch()}
        />
      ) : (
        <>
          {liveRecipeIds(days).length > 0 && (
            <Button
              variant="secondary"
              className="mb-3"
              onClick={() => shop(isThisWeek ? 'this week' : weekLabel(monday, sunday), days)}
            >
              <ListPlus aria-hidden className="h-5 w-5" />
              Add this week&apos;s ingredients
            </Button>
          )}
          <ul aria-label="Days" className="space-y-3">
            {days.map((d) => (
              <DayCard
                key={d}
                date={d}
                today={d === today}
                entries={entries}
                byId={byId}
                recipesLoaded={!recipes.isPending}
                canShop={liveRecipeIds([d]).length > 0}
                onAdd={(meal) => setAdding({ date: d, meal })}
                onOpen={setOpen}
                onShop={() => shop(weekdayName(d), [d])}
              />
            ))}
          </ul>
        </>
      )}

      {adding && (
        <AddToPlanSheet
          date={adding.date}
          defaultMeal={adding.meal}
          onClose={() => setAdding(null)}
        />
      )}
      {open && (
        <EntrySheet
          entry={open}
          recipe={byId.get(open.recipeId ?? '')}
          recipeGone={!recipes.isPending && !byId.has(open.recipeId ?? '')}
          onClose={() => setOpen(null)}
        />
      )}
      {shopFor && (
        <PlanIngredientsSheet
          title={shopFor.title}
          recipeIds={liveRecipeIds(shopFor.dates)}
          titles={Object.fromEntries([...byId].map(([id, r]) => [id, r.title]))}
          onClose={() => setShopFor(null)}
        />
      )}
    </div>
  );
}

function DayCard({
  date,
  today,
  entries,
  byId,
  recipesLoaded,
  canShop,
  onAdd,
  onOpen,
  onShop,
}: {
  date: string;
  today: boolean;
  entries: readonly MealPlanEntry[];
  byId: ReadonlyMap<string, RecipeSummary>;
  recipesLoaded: boolean;
  canShop: boolean;
  onAdd: (meal: PlanMeal | null) => void;
  onOpen: (e: MealPlanEntry) => void;
  onShop: () => void;
}) {
  const slots: Array<PlanMeal | null> = [...PLAN_MEALS, null];
  const empty = slots.filter((m) => entriesFor(entries, date, m).length === 0);
  return (
    <li
      aria-label={`${weekdayName(date)}${today ? ' (today)' : ''}`}
      className={`rounded-md border-2 p-3 ${today ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'}`}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-lg">
          {dayLabel(date)}
          {today && (
            <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-semibold text-accent-on">
              Today
            </span>
          )}
        </h3>
        {canShop && (
          <button
            type="button"
            aria-label={`Add ingredients for ${weekdayName(date)}`}
            onClick={onShop}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-accent"
          >
            <ListPlus aria-hidden className="h-6 w-6" />
          </button>
        )}
      </div>
      {slots.map((m) => {
        const list = entriesFor(entries, date, m);
        if (list.length === 0) return null;
        return (
          <section
            key={m ?? 'other'}
            aria-label={`${weekdayName(date)} ${m ? MEAL_LABELS[m] : 'Other'}`}
          >
            <h4 className="mt-2 text-xs uppercase tracking-wide text-muted">
              {m ? MEAL_LABELS[m] : 'Other'}
            </h4>
            <ul>
              {list.map((e) => (
                <EntryRow
                  key={e.id}
                  e={e}
                  recipe={byId.get(e.recipeId ?? '')}
                  gone={recipesLoaded}
                  onOpen={() => onOpen(e)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {empty.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-1">
          {empty.map((m) => (
            <button
              key={m ?? 'other'}
              type="button"
              aria-label={`Add ${m ? MEAL_LABELS[m].toLowerCase() : 'other'} on ${weekdayName(date)}`}
              onClick={() => onAdd(m)}
              className="inline-flex min-h-tap items-center gap-1 rounded-sm px-2 text-sm font-semibold text-muted"
            >
              <Plus aria-hidden className="h-4 w-4" />
              {m ? MEAL_LABELS[m] : 'Other'}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function EntryRow({
  e,
  recipe,
  gone,
  onOpen,
}: {
  e: MealPlanEntry;
  recipe: RecipeSummary | undefined;
  /** True once recipes have loaded, so a missing one really is deleted. */
  gone: boolean;
  onOpen: () => void;
}) {
  const deleted = e.kind === 'recipe' && !recipe && gone;
  const title =
    e.kind === 'text' ? (e.text ?? '') : deleted ? 'Recipe deleted' : (recipe?.title ?? '...');
  const sub = e.kind === 'recipe' && recipe?.totalTime ? recipe.totalTime : '';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 rounded-sm py-1 text-left"
      >
        {e.kind === 'recipe' && !deleted ? (
          <RecipePhoto src={recipe?.thumbUrl ?? null} className="h-12 w-12 shrink-0 rounded-sm" />
        ) : (
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent"
          >
            <Utensils className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block break-words text-base font-semibold ${deleted ? 'italic text-muted' : ''}`}
          >
            {title}
          </span>
          {(sub || e.note) && (
            <span className="block break-words text-sm text-muted">
              {[sub, e.note].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className="sr-only">Actions</span>
        </span>
      </button>
    </li>
  );
}
