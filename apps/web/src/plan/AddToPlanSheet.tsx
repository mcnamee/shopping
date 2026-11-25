import { filterRecipes, type PlanMeal, type RecipeSummary } from '@trolley/core';
import { storeToday } from '@trolley/core';
import { Check, CircleAlert, Search, Star } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { ApiError, createPlanEntry } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { SheetHeader } from '../lists/ListSheets';
import { RecipePhoto } from '../recipes/RecipeThumb';
import { recipeMeta, useRecipesQuery } from '../recipes/data';
import { MEAL_OPTIONS, dayLabel, mealLabel, useRefreshPlan } from './data';

interface Props {
  /** Day to add to (YYYY-MM-DD); the sheet lets the person change it. */
  date: string;
  defaultMeal: PlanMeal | null;
  /** Fixed recipe (from a recipe's page): hides the recipe/text choice. */
  recipe?: { id: string; title: string };
  onClose: () => void;
}

const FAILED = "Couldn't add that. Please try again.";

/**
 * Add to the plan (docs/stages/stage-6.md B3): day, meal (Breakfast/Lunch/Dinner/None), then
 * a recipe from a searchable list (favourites first) or free text with an optional note.
 */
export function AddToPlanSheet({ date: initialDate, defaultMeal, recipe, onClose }: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const refresh = useRefreshPlan();
  const recipes = useRecipesQuery();
  const [date, setDate] = useState(initialDate);
  const [meal, setMeal] = useState<PlanMeal | null>(defaultMeal);
  const [mode, setMode] = useState<'recipe' | 'text'>('recipe');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(recipe?.id ?? null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const shown = useMemo(() => {
    const all = filterRecipes(recipes.data?.recipes ?? [], { q });
    // Favourites first, A-Z within each group.
    return [...all.filter((r) => r.favourite), ...all.filter((r) => !r.favourite)];
  }, [recipes.data, q]);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const ready = validDate && (recipe || mode === 'recipe' ? picked !== null : text.trim() !== '');

  const submit = async () => {
    if (busy || !ready) {
      if (!validDate) setBanner('Choose a day.');
      else if (mode === 'text' && !recipe) setBanner('Enter some text.');
      else setBanner('Choose a recipe.');
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await createPlanEntry({
        date,
        meal,
        ...(recipe || mode === 'recipe'
          ? { kind: 'recipe' as const, recipeId: picked as string }
          : { kind: 'text' as const, text: text.trim() }),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await refresh();
      toast.show(`Added to ${dayLabel(date)}, ${mealLabel(meal).toLowerCase()}`);
      onClose();
    } catch (err) {
      setBusy(false);
      setBanner(
        err instanceof ApiError && err.status === 409
          ? 'That day is full (20 entries).'
          : err instanceof ApiError && err.status === 400
            ? err.message
            : FAILED,
      );
    }
  };

  const field =
    'block min-h-primary w-full rounded-md border-2 border-border bg-surface px-3 text-base text-text placeholder:text-muted focus:border-accent';

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={
        <SheetHeader
          id={headingId}
          title={recipe ? 'Add to plan' : `Add to ${dayLabel(initialDate)}`}
          headingRef={heading}
          onClose={onClose}
        />
      }
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
            busyLabel="Adding..."
            aria-disabled={!ready}
            onClick={() => void submit()}
          >
            Add to plan
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      {recipe && <p className="mb-3 break-words text-lg font-semibold">{recipe.title}</p>}
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
          min={storeToday()}
          onChange={(e) => setDate(e.target.value)}
          className={field}
        />
      </div>
      <Meals value={meal} onChange={setMeal} id={headingId} />
      {!recipe && (
        <div role="group" aria-label="Kind of entry" className="mb-3 flex gap-2">
          {(['recipe', 'text'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-tap flex-1 rounded-full border-2 px-4 text-base font-semibold ${
                mode === m ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface'
              }`}
            >
              {m === 'recipe' ? 'Recipe' : 'Something else'}
            </button>
          ))}
        </div>
      )}
      {!recipe && mode === 'recipe' && (
        <div>
          <div className="relative mb-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search recipes"
              placeholder="Search recipes"
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${field} appearance-none pl-10 [&::-webkit-search-cancel-button]:hidden`}
            />
          </div>
          {recipes.isPending ? (
            <p className="py-3 text-muted">Loading recipes...</p>
          ) : shown.length === 0 ? (
            <p className="py-3 text-muted">
              {(recipes.data?.recipes.length ?? 0) === 0 ? 'No recipes yet.' : 'No recipes match.'}
            </p>
          ) : (
            <ul role="radiogroup" aria-label="Recipes">
              {shown.map((r) => (
                <RecipeRow key={r.id} r={r} on={picked === r.id} onPick={() => setPicked(r.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
      {!recipe && mode === 'text' && (
        <div className="mb-3">
          <label
            htmlFor={`${headingId}-text`}
            className="mb-1 block text-xs uppercase tracking-wide text-muted"
          >
            What
          </label>
          <input
            id={`${headingId}-text`}
            type="text"
            maxLength={100}
            placeholder="Leftovers, eat out..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={field}
          />
        </div>
      )}
      {(recipe || mode === 'text' || picked) && (
        <div className="mt-3">
          <label
            htmlFor={`${headingId}-note`}
            className="mb-1 block text-xs uppercase tracking-wide text-muted"
          >
            Note (optional)
          </label>
          <input
            id={`${headingId}-note`}
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={field}
          />
        </div>
      )}
    </BottomSheet>
  );
}

/** Breakfast / Lunch / Dinner / None. */
export function Meals({
  value,
  onChange,
  id,
}: {
  value: PlanMeal | null;
  onChange: (m: PlanMeal | null) => void;
  id: string;
}) {
  return (
    <div className="mb-3">
      <p id={`${id}-meal`} className="mb-1 text-xs uppercase tracking-wide text-muted">
        Meal
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-meal`} className="grid grid-cols-4 gap-2">
        {MEAL_OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`min-h-tap rounded-md border-2 px-1 text-base font-semibold ${
              value === o.value ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecipeRow({ r, on, onPick }: { r: RecipeSummary; on: boolean; onPick: () => void }) {
  const meta = recipeMeta(r);
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onPick}
        className={`flex min-h-14 w-full items-center gap-3 rounded-sm px-1 py-1 text-left ${on ? 'bg-accent-soft' : ''}`}
      >
        <RecipePhoto src={r.thumbUrl} className="h-12 w-12 shrink-0 rounded-sm" />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-base font-semibold">{r.title}</span>
          {meta && <span className="block text-sm text-muted">{meta}</span>}
        </span>
        {r.favourite && (
          <Star
            aria-label="Favourite"
            className="h-4 w-4 shrink-0 text-accent"
            fill="currentColor"
          />
        )}
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center">
          {on && <Check className="h-5 w-5 text-accent" strokeWidth={3} />}
        </span>
      </button>
    </li>
  );
}
