import { storeToday, type MealPlanEntry, type PlanMeal, type RecipeSummary } from '@trolley/core';
import { CircleAlert, ExternalLink, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, createPlanEntry, deletePlanEntry, movePlanEntry } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { SheetHeader } from '../lists/ListSheets';
import { Meals } from './AddToPlanSheet';
import { dayLabel, mealLabel, useRefreshPlan } from './data';

/** Entry actions (docs/stages/stage-6.md B4): open recipe, move to another day/meal, delete with Undo. */
export function EntrySheet({
  entry,
  recipe,
  recipeGone,
  onClose,
}: {
  entry: MealPlanEntry;
  recipe: RecipeSummary | undefined;
  recipeGone: boolean;
  onClose: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshPlan();
  const [date, setDate] = useState(entry.date);
  const [meal, setMeal] = useState<PlanMeal | null>(entry.meal);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const title =
    entry.kind === 'recipe'
      ? (recipe?.title ?? (recipeGone ? 'Recipe deleted' : 'Recipe'))
      : (entry.text ?? '');
  const changed = date !== entry.date || meal !== entry.meal;

  const fail = (err: unknown) => {
    setBusy(false);
    setBanner(
      err instanceof ApiError && err.status === 409
        ? err.body &&
          typeof err.body === 'object' &&
          'reason' in err.body &&
          err.body.reason === 'LIMIT'
          ? 'That day is full (20 entries).'
          : 'Changed on another phone. Close this and try again.'
        : "Couldn't do that. Check your connection.",
    );
  };

  const move = async () => {
    if (busy || !changed || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setBusy(true);
    setBanner(null);
    try {
      await movePlanEntry(entry.date, entry.id, { version: entry.version, date, meal });
      await refresh();
      toast.show(`Moved to ${dayLabel(date)}, ${mealLabel(meal).toLowerCase()}`);
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      await deletePlanEntry(entry.date, entry.id);
      await refresh();
      onClose();
      toast.show('Removed from the plan', {
        durationMs: 8000,
        action: {
          label: 'Undo',
          onAction: () => {
            createPlanEntry({
              date: entry.date,
              meal: entry.meal,
              order: entry.order,
              ...(entry.kind === 'recipe'
                ? { kind: 'recipe' as const, recipeId: entry.recipeId as string }
                : { kind: 'text' as const, text: entry.text ?? '' }),
              ...(entry.note ? { note: entry.note } : {}),
            })
              .then(refresh)
              .catch(() => toast.show("Couldn't undo. Check your connection."));
          },
        },
      });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={<SheetHeader id={headingId} title={title} headingRef={heading} onClose={onClose} />}
      footer={
        <>
          {banner && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              {banner}
            </p>
          )}
          <Button
            busy={busy}
            busyLabel="Working..."
            aria-disabled={!changed}
            onClick={() => void move()}
          >
            Move
          </Button>
          <Button variant="danger-outline" disabled={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden className="h-5 w-5" />
            Delete
          </Button>
        </>
      }
    >
      {entry.note && <p className="mb-3 break-words text-base text-muted">{entry.note}</p>}
      {entry.kind === 'recipe' && recipe && (
        <Button
          variant="secondary"
          className="mb-4"
          onClick={() => {
            onClose();
            navigate(`/recipes/${recipe.id}`);
          }}
        >
          <ExternalLink aria-hidden className="h-5 w-5" />
          Open recipe
        </Button>
      )}
      <div className="mb-3">
        <label
          htmlFor={`${headingId}-day`}
          className="mb-1 block text-xs uppercase tracking-wide text-muted"
        >
          Day
        </label>
        <input
          id={`${headingId}-day`}
          type="date"
          value={date}
          min={entry.date < storeToday() ? entry.date : storeToday()}
          onChange={(e) => setDate(e.target.value)}
          className="block min-h-primary w-full rounded-md border-2 border-border bg-surface px-3 text-base text-text focus:border-accent"
        />
      </div>
      <Meals value={meal} onChange={setMeal} id={headingId} />
    </BottomSheet>
  );
}
