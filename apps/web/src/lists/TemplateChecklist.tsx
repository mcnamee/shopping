import { sortTemplates, type TemplateSummary } from '@trolley/core';
import { Check } from 'lucide-react';
import { TypeBadge } from '../components/TypeBadge';

interface TemplateChecklistProps {
  templates: readonly TemplateSummary[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  label?: string;
}

/** Template multi-select rows (docs/ux/lists.md 2): whole row toggles, badge and count right. */
export function TemplateChecklist({
  templates,
  selected,
  onToggle,
  label = 'Templates',
}: TemplateChecklistProps) {
  return (
    <ul aria-label={label} className="space-y-1">
      {sortTemplates(templates).map((t) => {
        const on = selected.has(t.id);
        return (
          <li key={t.id}>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-sm px-1">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(t.id)}
                  className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <span
                  aria-hidden
                  className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
                    on ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
                  }`}
                >
                  {on && <Check className="h-4 w-4" strokeWidth={3} />}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-lg">{t.name}</span>
              <TypeBadge type={t.type} />
              <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-muted">
                {t.itemCount}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
