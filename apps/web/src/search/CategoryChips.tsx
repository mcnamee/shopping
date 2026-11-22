import type { GroupSummary } from '@trolley/core';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface CategoryChipsProps {
  groups: readonly GroupSummary[];
  /** Selected group id, or undefined for All. */
  value: string | undefined;
  onChange: (groupId: string | undefined) => void;
}

/**
 * Single-select category chips (docs/ux/search.md 2.2): radiogroup with roving tabindex.
 * Tapping the selected chip again returns to All. Selected chip scrolls into view.
 */
export function CategoryChips({ groups, value, onChange }: CategoryChipsProps) {
  const row = useRef<HTMLDivElement>(null);
  const items: Array<{ id: string | undefined; label: string }> = [
    { id: undefined, label: 'All' },
    ...groups.map((g) => ({ id: g.id, label: g.shortName })),
  ];

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    if (value === undefined) {
      el.scrollLeft = 0;
      return;
    }
    // Keep the selected chip fully inside the row (never scrolls the page vertically).
    const chip = el.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!chip) return;
    const pad = 16;
    if (chip.offsetLeft - pad < el.scrollLeft) el.scrollLeft = chip.offsetLeft - pad;
    else if (chip.offsetLeft + chip.offsetWidth + 40 > el.scrollLeft + el.clientWidth)
      el.scrollLeft = chip.offsetLeft + chip.offsetWidth + 40 - el.clientWidth;
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = Math.min(items.length - 1, index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next]?.id);
    requestAnimationFrame(() =>
      row.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus(),
    );
  };

  return (
    <div className="relative">
      <div
        ref={row}
        role="radiogroup"
        aria-label="Filter by category"
        className="no-scrollbar flex scroll-pl-[max(16px,var(--safe-left))] snap-x gap-2 overflow-x-auto overscroll-x-contain py-1 pl-[max(16px,var(--safe-left))] pr-10"
      >
        {items.map((item, i) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id ?? 'all'}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(selected && item.id !== undefined ? undefined : item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex min-h-tap shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border-2 px-4 text-base font-semibold ${
                selected
                  ? 'border-accent bg-accent text-accent-on active:bg-accent-strong'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {selected && <Check aria-hidden className="h-4 w-4" strokeWidth={3} />}
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent"
      />
    </div>
  );
}
