import {
  filterRecipes,
  nextWeekdayOnOrAfter,
  planWeekday,
  PLAN_WEEKDAYS,
  storeToday,
  type PlanMeal,
  type PlanRule,
  type PlanRuleRequest,
  type PlanWeekday,
} from '@trolley/core';
import { CircleAlert, Search, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { ApiError, createPlanRule, deletePlanRule, updatePlanRule } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { DateField } from '../components/DateField';
import { useToast } from '../components/Toast';
import { SheetHeader } from '../lists/ListSheets';
import { useRecipesQuery } from '../recipes/data';
import { Meals, RecipeRow } from './AddToPlanSheet';
import { FREQUENCY_OPTIONS, shortDate, weekdayLabel, useRefreshPlan } from './data';

/** Starting values for a new rule ("Make this recurring" prefills them from an entry). */
export interface RulePrefill {
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  meal?: PlanMeal | null;
  startDate?: string;
  note?: string;
}

interface Props {
  /** Edit this rule; omit to add one. */
  rule?: PlanRule;
  prefill?: RulePrefill;
  onClose: () => void;
}

const field =
  'block min-h-primary w-full min-w-0 rounded-md border-2 border-border bg-surface px-3 text-base text-text placeholder:text-muted focus:border-accent';
const label = 'mb-1 block text-xs uppercase tracking-wide text-muted';
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * Add or edit a recurring meal (docs/stages/stage-6b.md B2). The start date and the weekday
 * always agree: changing one moves the other (the start moves to the next matching day).
 */
export function RuleSheet({ rule, prefill, onClose }: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const refresh = useRefreshPlan();
  const recipes = useRecipesQuery();
  const initial = rule ?? prefill;
  const initialStart = rule?.startDate ?? prefill?.startDate ?? storeToday();
  const [kind, setKind] = useState<'recipe' | 'text'>(initial?.kind ?? 'recipe');
  const [picked, setPicked] = useState<string | null>(initial?.recipeId ?? null);
  const [q, setQ] = useState('');
  const [text, setText] = useState(initial?.text ?? '');
  const [meal, setMeal] = useState<PlanMeal | null>(initial?.meal ?? 'dinner');
  const [startDate, setStartDate] = useState(initialStart);
  const [weekday, setWeekday] = useState<PlanWeekday>(planWeekday(initialStart));
  const [everyWeeks, setEveryWeeks] = useState(rule?.everyWeeks ?? 1);
  const [endDate, setEndDate] = useState(rule?.endDate ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [paused, setPaused] = useState(rule?.paused ?? false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const shown = useMemo(() => {
    const all = filterRecipes(recipes.data?.recipes ?? [], { q });
    return [...all.filter((r) => r.favourite), ...all.filter((r) => !r.favourite)];
  }, [recipes.data, q]);

  const pickWeekday = (w: PlanWeekday) => {
    setWeekday(w);
    setStartDate((d) => nextWeekdayOnOrAfter(d, w));
  };
  const pickStart = (d: string) => {
    if (!isDate(d)) return;
    setStartDate(d);
    setWeekday(planWeekday(d));
  };

  const submit = async () => {
    if (busy) return;
    if (kind === 'recipe' && !picked) return setBanner('Choose a recipe.');
    if (kind === 'text' && !text.trim()) return setBanner('Enter some text.');
    if (!isDate(startDate)) return setBanner('Choose a start date.');
    if (endDate && endDate < startDate)
      return setBanner('The end date must not be before the start.');
    setBusy(true);
    setBanner(null);
    const body: PlanRuleRequest = {
      ...(kind === 'recipe'
        ? { kind: 'recipe' as const, recipeId: picked as string }
        : { kind: 'text' as const, text: text.trim() }),
      meal,
      weekday,
      everyWeeks,
      startDate,
      endDate: endDate || null,
      note: note.trim() || null,
      paused,
    };
    try {
      if (rule) await updatePlanRule(rule.id, { ...body, version: rule.version });
      else await createPlanRule(body);
      await refresh();
      toast.show(rule ? 'Recurring meal updated' : 'Recurring meal added');
      onClose();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        const reason =
          err.body && typeof err.body === 'object' && 'reason' in err.body ? err.body.reason : '';
        setBanner(
          reason === 'LIMIT'
            ? 'You can have up to 30 recurring meals. Remove one first.'
            : 'Changed on another phone. Close this and try again.',
        );
      } else if (err instanceof ApiError && err.status === 400) {
        setBanner(err.message);
      } else {
        setBanner("Couldn't save that. Check your connection.");
      }
    }
  };

  const remove = async () => {
    if (!rule || busy) return;
    setBusy(true);
    try {
      await deletePlanRule(rule.id);
      await refresh();
      toast.show('Recurring meal deleted');
      onClose();
    } catch {
      setBusy(false);
      setConfirmDelete(false);
      setBanner("Couldn't delete that. Check your connection.");
    }
  };

  return (
    <>
      <BottomSheet
        labelledBy={headingId}
        initialFocusRef={heading}
        busy={busy}
        onClose={onClose}
        header={
          <SheetHeader
            id={headingId}
            title={rule ? 'Edit recurring meal' : 'New recurring meal'}
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
            <Button busy={busy} busyLabel="Saving..." onClick={() => void submit()}>
              {rule ? 'Save' : 'Add recurring meal'}
            </Button>
            {rule ? (
              <Button
                variant="danger-outline"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden className="h-5 w-5" />
                Delete
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            )}
          </>
        }
      >
        <div role="group" aria-label="Kind of meal" className="mb-3 flex gap-2">
          {(['recipe', 'text'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={kind === m}
              onClick={() => setKind(m)}
              className={`min-h-tap flex-1 rounded-full border-2 px-4 text-base font-semibold ${
                kind === m ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface'
              }`}
            >
              {m === 'recipe' ? 'Recipe' : 'Something else'}
            </button>
          ))}
        </div>
        {kind === 'recipe' ? (
          <div className="mb-3">
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
                {(recipes.data?.recipes.length ?? 0) === 0
                  ? 'No recipes yet.'
                  : 'No recipes match.'}
              </p>
            ) : (
              <ul role="radiogroup" aria-label="Recipes" className="max-h-64 overflow-y-auto">
                {shown.map((r) => (
                  <RecipeRow key={r.id} r={r} on={picked === r.id} onPick={() => setPicked(r.id)} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mb-3">
            <label htmlFor={`${headingId}-text`} className={label}>
              What
            </label>
            <input
              id={`${headingId}-text`}
              type="text"
              maxLength={100}
              placeholder="Pizza night, eat out..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={field}
            />
          </div>
        )}
        <Meals value={meal} onChange={setMeal} id={headingId} />
        <div className="mb-3">
          <p id={`${headingId}-weekday`} className={label}>
            Day of the week
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${headingId}-weekday`}
            className="grid grid-cols-7 gap-1"
          >
            {PLAN_WEEKDAYS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={weekday === w}
                aria-label={weekdayLabel(w)}
                onClick={() => pickWeekday(w)}
                className={`min-h-tap rounded-md border-2 px-0 text-base font-semibold ${
                  weekday === w ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'
                }`}
              >
                {weekdayLabel(w).slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <p id={`${headingId}-freq`} className={label}>
            How often
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${headingId}-freq`}
            className="grid grid-cols-2 gap-2"
          >
            {FREQUENCY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={everyWeeks === o.value}
                onClick={() => setEveryWeeks(o.value)}
                className={`min-h-tap rounded-md border-2 px-2 text-base font-semibold ${
                  everyWeeks === o.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-border-subtle bg-surface'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <label htmlFor={`${headingId}-start`} className={label}>
            Starts
          </label>
          <DateField id={`${headingId}-start`} value={startDate} onChange={pickStart} />
          {everyWeeks > 1 && (
            <p className="mt-1 text-sm text-muted">
              Counting from {shortDate(startDate)}, every {everyWeeks} weeks.
            </p>
          )}
        </div>
        <div className="mb-3">
          <label htmlFor={`${headingId}-end`} className={label}>
            Ends (optional)
          </label>
          <DateField
            id={`${headingId}-end`}
            value={endDate}
            min={startDate}
            onChange={setEndDate}
          />
          {endDate && (
            <button
              type="button"
              onClick={() => setEndDate('')}
              className="mt-1 min-h-tap rounded-sm px-1 text-base font-semibold text-accent"
            >
              Clear end date
            </button>
          )}
        </div>
        <div className="mb-3">
          <label htmlFor={`${headingId}-note`} className={label}>
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
        <button
          type="button"
          role="switch"
          aria-checked={paused}
          onClick={() => setPaused(!paused)}
          className="flex min-h-tap w-full items-center justify-between gap-3 rounded-md border-2 border-border-subtle bg-surface px-3 text-left text-base font-semibold"
        >
          <span>
            Paused
            <span className="block text-sm font-normal text-muted">
              Keeps the meal but hides it from the plan.
            </span>
          </span>
          <span
            aria-hidden
            className={`flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 ${paused ? 'justify-end bg-accent' : 'justify-start bg-border'}`}
          >
            <span className="h-6 w-6 rounded-full bg-surface" />
          </span>
        </button>
      </BottomSheet>
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this recurring meal?"
          description="It stops appearing on the plan. Meals you have already added by hand stay."
          confirm="Delete"
          cancel="Keep"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
