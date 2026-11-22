import { LayoutTemplate, Plus, ChevronRight } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  LIMITS,
  isTemplateType,
  sortTemplates,
  type TemplateSummary,
  type TemplateType,
} from '@trolley/core';
import { AppBarAction } from '../components/appBar';
import { Button } from '../components/Button';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { TypeBadge } from '../components/TypeBadge';
import { useTemplatesQuery } from '../lists/data';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';

type Filter = 'all' | TemplateType;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'meal', label: 'Meal' },
  { id: 'regulars', label: 'Regulars' },
];

const previewLine = (t: TemplateSummary) =>
  t.itemCount === 0
    ? 'No items yet'
    : `${t.preview.join(', ')}${t.itemCount > t.preview.length ? `, +${t.itemCount - t.preview.length}` : ''}`;

/** Templates tab (docs/ux/templates.md 1). */
export function TemplatesPage() {
  const query = useTemplatesQuery();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const raw = params.get('type');
  const filter: Filter = isTemplateType(raw) ? raw : 'all';
  const all = query.data?.templates;

  const newTemplate = (type?: TemplateType) => {
    if (!online) {
      toast.show("You're offline. Reconnect to create a template.");
      return;
    }
    if ((all?.length ?? 0) >= LIMITS.templates) {
      toast.show(`You have ${LIMITS.templates} templates, which is the most Trolley allows.`);
      return;
    }
    navigate(type ? `/templates/new?type=${type}` : '/templates/new');
  };

  const shown = sortTemplates(all ?? []).filter((t) => filter === 'all' || t.type === filter);
  const newType = filter === 'all' ? undefined : filter;

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only">Loading templates</p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (query.isError && !all) {
    body = (
      <ErrorView
        title="Couldn't load your templates"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (all?.length === 0) {
    body = (
      <EmptyView
        Icon={LayoutTemplate}
        title="No templates yet"
        body="Save your regular shops, like your weekly basics or a favourite meal, and reuse them in a tap."
      >
        <Button onClick={() => newTemplate()} aria-disabled={!online}>
          <Plus aria-hidden className="h-5 w-5" />
          New template
        </Button>
      </EmptyView>
    );
  } else {
    body = (
      <>
        <div role="radiogroup" aria-label="Filter templates" className="mb-3 flex gap-2">
          {FILTERS.map((f) => {
            const on = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() =>
                  setParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      if (f.id === 'all') next.delete('type');
                      else next.set('type', f.id);
                      return next;
                    },
                    { replace: true },
                  )
                }
                className={`min-h-tap rounded-full border-2 px-4 text-base font-semibold ${
                  on
                    ? 'border-accent bg-accent text-accent-on'
                    : 'border-border bg-surface text-text'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {shown.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-lg">No {filter} templates yet</p>
            <Button className="mt-4" onClick={() => newTemplate(newType)} aria-disabled={!online}>
              New template
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/templates/${t.id}`}
                  className="flex min-h-[88px] items-center gap-2 rounded-md bg-surface p-4 active:bg-accent-soft"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-lg">{t.name}</span>
                      <TypeBadge type={t.type} />
                    </span>
                    <span className="mt-1 block text-sm font-normal text-muted">
                      <span className="sr-only">{t.type} template, </span>
                      {t.itemCount} {t.itemCount === 1 ? 'item' : 'items'}
                    </span>
                    <span aria-hidden className="block truncate text-sm font-normal text-muted">
                      {previewLine(t)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className={all && all.length > 0 ? 'pb-20' : ''}>
      <AppBarAction>
        <button
          type="button"
          aria-label="New template"
          aria-disabled={!online}
          onClick={() => newTemplate(newType)}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm"
        >
          <Plus aria-hidden className="h-6 w-6" />
        </button>
      </AppBarAction>
      {body}
      {all && all.length > 0 && (
        <button
          type="button"
          aria-disabled={!online}
          onClick={() => newTemplate(newType)}
          className="fixed bottom-[calc(var(--nav-height)+16px)] right-[max(16px,var(--safe-right))] z-20 flex h-14 items-center gap-2 rounded-full bg-accent px-5 text-lg text-accent-on shadow-sheet active:bg-accent-strong"
        >
          <Plus aria-hidden className="h-6 w-6" />
          New template
        </button>
      )}
    </div>
  );
}
