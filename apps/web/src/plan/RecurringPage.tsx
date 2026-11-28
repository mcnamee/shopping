import { PLAN_WEEKDAYS, type PlanRule } from '@trolley/core';
import { Plus, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useDelayedFlag } from '../search/hooks';
import { useRecipesQuery } from '../recipes/data';
import { RuleSheet } from './RuleSheet';
import { mealTitle, ruleSummary, useRulesQuery, weekdayLabel } from './data';

/** Recurring meals (docs/stages/stage-6b.md B2): a pushed screen listing rules by weekday. */
export function RecurringPage() {
  const rules = useRulesQuery();
  const recipes = useRecipesQuery();
  const showSkeleton = useDelayedFlag(rules.isPending, 150);
  const [sheet, setSheet] = useState<{ rule?: PlanRule } | null>(null);
  const titles = new Map((recipes.data?.recipes ?? []).map((r) => [r.id, r.title] as const));
  const all = rules.data?.rules ?? [];

  let body: React.ReactNode;
  if (rules.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-2">
        <p className="sr-only">Loading recurring meals</p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (rules.isError && !rules.data) {
    body = (
      <ErrorView
        title="Couldn't load recurring meals"
        error={rules.error}
        onRetry={() => void rules.refetch()}
      />
    );
  } else if (all.length === 0) {
    body = (
      <EmptyView
        Icon={Repeat}
        title="No recurring meals"
        body="Add meals that happen on the same day every week or fortnight, like pizza on Fridays."
      >
        <Button onClick={() => setSheet({})}>Add recurring meal</Button>
      </EmptyView>
    );
  } else {
    body = (
      <div className="space-y-4">
        {PLAN_WEEKDAYS.map((w) => {
          const group = all.filter((r) => r.weekday === w);
          if (group.length === 0) return null;
          return (
            <section key={w} aria-label={weekdayLabel(w)}>
              <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">{weekdayLabel(w)}</h2>
              <ul className="overflow-hidden rounded-md bg-surface">
                {group.map((r) => (
                  <li key={r.id} className="border-b border-border-subtle last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSheet({ rule: r })}
                      className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left"
                    >
                      <Repeat
                        aria-hidden
                        className={`h-5 w-5 shrink-0 ${r.paused ? 'text-muted' : 'text-accent'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block break-words text-base font-semibold ${r.paused ? 'text-muted' : ''}`}
                        >
                          {mealTitle(r, titles.get(r.recipeId ?? ''), !recipes.isPending)}
                        </span>
                        <span className="block break-words text-sm text-muted">
                          {ruleSummary(r)}
                        </span>
                        {r.note && (
                          <span className="block break-words text-sm text-muted">{r.note}</span>
                        )}
                      </span>
                      {r.paused && (
                        <span className="shrink-0 rounded-full bg-border-subtle px-2 py-0.5 text-xs font-semibold">
                          Paused
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Recurring meals"
        backTo="/recipes"
        backLabel="Back to Recipes"
        right={
          <button
            type="button"
            aria-label="Add recurring meal"
            onClick={() => setSheet({})}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-accent"
          >
            <Plus aria-hidden className="h-6 w-6" />
          </button>
        }
      />
      <main className="px-[max(16px,var(--safe-left))] pb-4 pt-4">{body}</main>
      {sheet && (
        <RuleSheet
          key={sheet.rule?.id ?? 'new'}
          {...(sheet.rule ? { rule: sheet.rule } : {})}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
