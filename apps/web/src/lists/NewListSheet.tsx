import { useQueryClient } from '@tanstack/react-query';
import {
  ENTITY_NAME_MAX_LENGTH,
  defaultListName,
  type ListSummary,
  type TemplateSummary,
} from '@trolley/core';
import { Check, CircleAlert, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { createList } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { SegmentedControl } from '../search/SegmentedControl';
import { truncate } from '../search/format';
import { conflictReason, qk, summaryOf, upsertListSummary } from './data';
import { TemplateChecklist } from './TemplateChecklist';

interface NewListSheetProps {
  /** Active lists (for the "this week" row and the 10-list limit). */
  lists: readonly ListSummary[];
  templates: readonly TemplateSummary[];
  /** Start in "From templates" with these ticked (Templates > Add to a list > New list). */
  initialTemplateIds?: readonly string[];
  onClose: () => void;
}

const MAX_LISTS = 10;

/** New list sheet (docs/ux/lists.md 2): name, blank or from templates, this-week flag. */
export function NewListSheet({ lists, templates, initialTemplateIds, onClose }: NewListSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { online } = useOnlineStatus();
  const headingId = useId();
  const nameId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  const [name, setName] = useState(() => defaultListName(new Date()));
  const [mode, setMode] = useState<'blank' | 'templates' | 'suggestions'>(
    initialTemplateIds?.length ? 'templates' : 'blank',
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTemplateIds ?? []));
  const flagged = lists.find((l) => l.thisWeek);
  const firstList = lists.length === 0;
  const [thisWeek, setThisWeek] = useState(!flagged);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(lists.length >= MAX_LISTS);

  const chooseMode = (next: 'blank' | 'templates' | 'suggestions') => {
    setMode(next);
    if (next === 'templates' && selected.size === 0) {
      setSelected(new Set(templates.filter((t) => t.type === 'weekly').map((t) => t.id)));
    }
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const chosen = mode === 'templates' ? templates.filter((t) => selected.has(t.id)) : [];
  const createLabel =
    chosen.length >= 2
      ? `Create from ${chosen.length} templates`
      : chosen.length === 1
        ? `Create from ${truncate(chosen[0]?.name ?? '', 20)}`
        : mode === 'suggestions'
          ? 'Create and suggest'
          : 'Create list';

  const validate = (value: string) => {
    const t = value.trim();
    if (!t) return 'Enter a name for this list.';
    if (t.length > ENTITY_NAME_MAX_LENGTH) return 'Keep it to 60 characters or fewer.';
    return null;
  };

  const create = async () => {
    const err = validate(name);
    setNameError(err);
    if (err) {
      document.getElementById(nameId)?.focus();
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const res = await createList({
        name: name.trim(),
        ...(chosen.length ? { templateIds: chosen.map((t) => t.id) } : {}),
        thisWeek: firstList || thisWeek,
      });
      qc.setQueryData(qk.list(res.list.id), res.list);
      upsertListSummary(qc, summaryOf(res.list));
      void qc.invalidateQueries({ queryKey: qk.lists });
      const n = res.list.itemCount;
      // "Create and suggest": the list page opens the review sheet and toasts if nothing is added.
      if (mode !== 'suggestions') {
        toast.show(
          chosen.length
            ? `Created ${res.list.name} with ${n} ${n === 1 ? 'item' : 'items'}${
                res.combined > 0 ? ` (${res.combined} combined)` : ''
              }`
            : `Created ${res.list.name}`,
        );
      }
      navigate(`/lists/${res.list.id}`, {
        state: { name: res.list.name, ...(mode === 'suggestions' ? { suggest: true } : {}) },
      });
      onClose();
    } catch (e) {
      setBusy(false);
      if (conflictReason(e) === 'LIMIT') setBlocked(true);
      else setFailed(true);
    }
  };

  const header = (
    <div className="flex items-center gap-2 pb-2">
      <h2
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="min-w-0 flex-1 text-xl focus:outline-none"
      >
        New list
      </h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm"
      >
        <X aria-hidden className="h-6 w-6" />
      </button>
    </div>
  );

  if (blocked) {
    return (
      <BottomSheet
        labelledBy={headingId}
        initialFocusRef={heading}
        onClose={onClose}
        header={header}
        footer={<Button onClick={onClose}>OK</Button>}
      >
        <p
          role="alert"
          className="rounded-sm bg-warning-soft px-3 py-3 text-base font-semibold text-warning-text"
        >
          You have 10 lists on the go, which is the most Trolley allows. Archive or delete one
          first.
        </p>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={header}
      footer={
        <>
          {failed && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              Couldn't create that list. Please try again.
            </p>
          )}
          {!online && (
            <p className="text-sm text-muted">You're offline. Reconnect to create a list.</p>
          )}
          <Button
            busy={busy}
            busyLabel="Creating..."
            aria-disabled={!online}
            onClick={() => online && void create()}
          >
            {createLabel}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <div>
          <label htmlFor={nameId} className="mb-1 block text-sm font-semibold">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            autoCapitalize="sentences"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setNameError(validate(name))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (online) void create();
              }
            }}
            className={`min-h-primary w-full rounded-md border-2 bg-surface px-3 text-lg ${
              nameError ? 'border-danger' : 'border-border'
            } focus:border-accent`}
          />
          {nameError && (
            <p id={`${nameId}-error`} className="mt-1 flex items-start gap-1 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {nameError}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold">Start with</p>
          <SegmentedControl
            label="Start with"
            columns={3}
            options={['blank', 'templates', 'suggestions'] as const}
            value={mode}
            onChange={chooseMode}
            optionLabel={(m) =>
              m === 'blank' ? 'Blank' : m === 'templates' ? 'From templates' : 'Suggestions'
            }
            ariaLabels={{ suggestions: 'Start with suggestions' }}
          />
          {mode === 'suggestions' && (
            <p className="mt-1 text-sm text-muted">
              We'll look at what you usually buy and suggest items to review.
            </p>
          )}
        </div>

        {mode === 'templates' &&
          (templates.length === 0 ? (
            <div>
              <p className="text-base text-muted">You haven't made any templates yet.</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/templates');
                }}
                className="min-h-tap rounded-sm font-semibold text-accent underline"
              >
                Go to Templates
              </button>
            </div>
          ) : (
            <div>
              <TemplateChecklist templates={templates} selected={selected} onToggle={toggle} />
              <p className="mt-1 text-sm text-muted">
                Matching items are combined, so you won't get doubles.
              </p>
            </div>
          ))}

        <div>
          <label
            className={`flex min-h-14 items-center gap-3 rounded-sm px-1 ${firstList ? '' : 'cursor-pointer'}`}
          >
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={firstList || thisWeek}
                aria-disabled={firstList || undefined}
                onChange={(e) => !firstList && setThisWeek(e.target.checked)}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span
                aria-hidden
                className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
                  firstList || thisWeek
                    ? 'border-accent bg-accent text-accent-on'
                    : 'border-border bg-bg'
                }`}
              >
                {(firstList || thisWeek) && <Check className="h-4 w-4" strokeWidth={3} />}
              </span>
            </span>
            <span className="text-lg">Set as this week's list</span>
          </label>
          {flagged && thisWeek && (
            <p className="px-1 text-sm text-muted">Replaces {flagged.name} as this week's list.</p>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
