import type { TemplateType } from '@trolley/core';
import { CalendarDays, UtensilsCrossed } from 'lucide-react';

/** Weekly / Meal badge (docs/ux/templates.md 1). Icon plus text, never colour alone. */
export function TypeBadge({ type }: { type: TemplateType }) {
  const weekly = type === 'weekly';
  const Icon = weekly ? CalendarDays : UtensilsCrossed;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
        weekly ? 'bg-accent-soft text-accent' : 'border border-border bg-surface-raised text-text'
      }`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {weekly ? 'Weekly' : 'Meal'}
    </span>
  );
}
