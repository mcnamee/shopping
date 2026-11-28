import type { PlanOccurrence, PlanRule, RecipeSummary } from '@trolley/core';
import { CircleAlert, ExternalLink, Pencil, Repeat, SkipForward, Undo2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { skipPlanOccurrence, unskipPlanOccurrence } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { SheetHeader } from '../lists/ListSheets';
import { dayLabel, everyLabel, mealLabel, mealTitle, useRefreshPlan } from './data';

/**
 * A recurring meal on the plan (docs/stages/stage-6b.md B1): open the recipe, skip this
 * week (with Undo), change this week only, or edit the rule.
 */
export function OccurrenceSheet({
  occurrence,
  rule,
  recipe,
  recipeGone,
  onChangeThisWeek,
  onEditRule,
  onClose,
}: {
  occurrence: PlanOccurrence;
  rule: PlanRule | undefined;
  recipe: RecipeSummary | undefined;
  recipeGone: boolean;
  onChangeThisWeek: () => void;
  onEditRule: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshPlan();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const title = mealTitle(occurrence, recipe?.title, recipeGone);

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      await skipPlanOccurrence(occurrence.ruleId, occurrence.date);
      await refresh();
      onClose();
      toast.show(`Skipped ${title} on ${dayLabel(occurrence.date)}`, {
        durationMs: 8000,
        action: {
          label: 'Undo',
          onAction: () => {
            unskipPlanOccurrence(occurrence.ruleId, occurrence.date)
              .then(refresh)
              .catch(() => toast.show("Couldn't undo. Check your connection."));
          },
        },
      });
    } catch {
      setBusy(false);
      setBanner("Couldn't skip that. Check your connection.");
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
          <Button busy={busy} busyLabel="Working..." onClick={() => void skip()}>
            <SkipForward aria-hidden className="h-5 w-5" />
            Skip this week
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onChangeThisWeek}>
            <Undo2 aria-hidden className="h-5 w-5" />
            Change this week only
          </Button>
          <Button variant="secondary" disabled={busy || !rule} onClick={onEditRule}>
            <Pencil aria-hidden className="h-5 w-5" />
            Edit recurring meal
          </Button>
        </>
      }
    >
      <p className="mb-4 flex items-center gap-2 text-base text-muted">
        <Repeat aria-hidden className="h-5 w-5 shrink-0" />
        {rule ? `${everyLabel(rule)} · ` : ''}
        {dayLabel(occurrence.date)}, {mealLabel(occurrence.meal).toLowerCase()}
      </p>
      {occurrence.note && <p className="mb-4 break-words text-base">{occurrence.note}</p>}
      {occurrence.kind === 'recipe' && recipe && (
        <Button
          variant="secondary"
          className="mb-2"
          onClick={() => {
            onClose();
            navigate(`/recipes/${recipe.id}`);
          }}
        >
          <ExternalLink aria-hidden className="h-5 w-5" />
          Open recipe
        </Button>
      )}
    </BottomSheet>
  );
}
