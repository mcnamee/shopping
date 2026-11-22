import { TEMPLATE_TYPE_LABELS, type TemplateType } from '@trolley/core';
import { CalendarDays, Repeat, UtensilsCrossed } from 'lucide-react';

const STYLE: Record<TemplateType, string> = {
  weekly: 'bg-accent-soft text-accent',
  meal: 'border border-border bg-surface-raised text-text',
  regulars: 'border border-accent bg-surface-raised text-accent',
};
const ICON = { weekly: CalendarDays, meal: UtensilsCrossed, regulars: Repeat } as const;

/** Weekly / Meal / Regulars badge (docs/ux/templates.md 1). Icon plus text, never colour alone. */
export function TypeBadge({ type }: { type: TemplateType }) {
  const Icon = ICON[type];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs ${STYLE[type]}`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {TEMPLATE_TYPE_LABELS[type]}
    </span>
  );
}
