import { ChevronLeft } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

interface PageHeaderProps {
  title: string;
  backTo: string;
  backLabel: string;
  /** Trailing control (e.g. Save). */
  right?: ReactNode;
  /** Replaces the title block (shop mode shows a sub-line). */
  children?: ReactNode;
  /** Full-width strip under the header row (shop mode's progress bar). */
  below?: ReactNode;
  /** Intercepts the back link (unsaved-changes guard). */
  onBack?: (e: React.MouseEvent) => void;
}

/**
 * Sticky app bar variant with a back button, used by sub-pages that replace the shell app
 * bar (docs/ux/settings-stage2.md 1, templates.md 2). Page title is the `<h1>`.
 */
export function PageHeader({
  title,
  backTo,
  backLabel,
  right,
  children,
  below,
  onBack,
}: PageHeaderProps) {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  // Fixed (not sticky) so the bar stays put during iOS rubber-band overscroll; the spacer
  // below keeps the page content clear of it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden data-testid="page-header-spacer" style={{ height }} />
      <header
        ref={ref}
        className="fixed inset-x-0 top-0 z-30 border-b border-border-subtle bg-surface pt-safe-top"
      >
        <div className="flex min-h-14 items-center gap-1 pl-[max(4px,var(--safe-left))] pr-[max(16px,var(--safe-right))]">
          <Link
            to={backTo}
            onClick={onBack}
            aria-label={backLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
          >
            <ChevronLeft aria-hidden className="h-6 w-6" />
          </Link>
          {children ?? <h1 className="min-w-0 flex-1 truncate text-xl">{title}</h1>}
          {right}
        </div>
        {below}
      </header>
    </>
  );
}
