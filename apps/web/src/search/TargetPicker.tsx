import { useQueryClient } from '@tanstack/react-query';
import {
  ENTITY_NAME_MAX_LENGTH,
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  defaultListName,
  sortActiveLists,
  sortTemplates,
  type ListSummary,
  type TemplateSummary,
  type TemplateType,
} from '@trolley/core';
import { Check, CircleAlert, Plus, Star } from 'lucide-react';
import { useId, useState } from 'react';
import { createList, createTemplate } from '../api';
import { Button } from '../components/Button';
import { TypeBadge } from '../components/TypeBadge';
import { qk, upsertListSummary, summaryOf } from '../lists/data';
import { SegmentedControl } from './SegmentedControl';
import type { AddTarget } from './target';

interface TargetPickerProps {
  value: AddTarget;
  lists: readonly ListSummary[] | undefined;
  templates: readonly TemplateSummary[] | undefined;
  listsError: boolean;
  online: boolean;
  /** Type preselected for "New template" (Meal when opened from the ListPlus icon). */
  newTemplateType: TemplateType;
  /** ListPlus first-open with no templates: the New template form starts expanded. */
  expandNewTemplate?: boolean;
  /** ListPlus first-open: the Templates section leads. */
  templatesFirst?: boolean;
  onSelect: (target: AddTarget) => void;
  onRetry: () => void;
}

const nameError = (value: string, kind: 'list' | 'template') => {
  const t = value.trim();
  if (!t) return `Enter a name for this ${kind}.`;
  if (t.length > ENTITY_NAME_MAX_LENGTH) return 'Keep it to 60 characters or fewer.';
  return null;
};

/**
 * Picker view of the quantity modal (docs/ux/quantity-modal.md 10.3): one radiogroup across
 * lists then templates; a tap selects and returns. Inline mini forms create a list or template.
 */
export function TargetPicker({
  value,
  lists,
  templates,
  listsError,
  online,
  newTemplateType,
  expandNewTemplate = false,
  templatesFirst = false,
  onSelect,
  onRetry,
}: TargetPickerProps) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState<'list' | 'template' | null>(
    expandNewTemplate ? 'template' : null,
  );
  const listItems = sortActiveLists(lists ?? []);
  const templateItems = sortTemplates(templates ?? []);
  const weekId = listItems.find((l) => l.thisWeek)?.id;

  const selectedId = value.kind === 'thisWeek' ? weekId : value.id;

  const listsSection = (
    <section aria-labelledby="picker-lists">
      <h3 id="picker-lists" className="mb-1 text-xs uppercase tracking-wide text-muted">
        Lists
      </h3>
      <div className="space-y-2">
        {lists === undefined && !listsError && (
          <>
            <div className="shimmer h-14 rounded-md" aria-hidden />
            <div className="shimmer h-14 rounded-md" aria-hidden />
          </>
        )}
        {listItems.map((l) => (
          <PickerRow
            key={l.id}
            selected={selectedId === l.id && value.kind !== 'template'}
            name={l.name}
            badge={
              l.thisWeek ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                  <Star aria-hidden className="h-3.5 w-3.5" />
                  This week
                </span>
              ) : null
            }
            meta={`${l.tickedCount}/${l.itemCount}`}
            onSelect={() => onSelect({ kind: 'list', id: l.id, name: l.name })}
          />
        ))}
      </div>
      {creating === 'list' ? (
        <NewListForm
          online={online}
          onCancel={() => setCreating(null)}
          onCreated={(l) => {
            upsertListSummary(qc, l);
            void qc.invalidateQueries({ queryKey: qk.lists });
            onSelect({ kind: 'list', id: l.id, name: l.name });
          }}
        />
      ) : (
        <AddRow label="New list" disabled={!online} onClick={() => setCreating('list')} />
      )}
    </section>
  );
  const tplSection = (
    <section aria-labelledby="picker-templates">
      <h3 id="picker-templates" className="mb-1 text-xs uppercase tracking-wide text-muted">
        Templates
      </h3>
      {templates?.length === 0 && (
        <p className="mb-2 text-sm text-muted">You don't have any templates yet.</p>
      )}
      <div className="space-y-2">
        {templateItems.map((t) => (
          <PickerRow
            key={t.id}
            selected={value.kind === 'template' && value.id === t.id}
            name={t.name}
            badge={<TypeBadge type={t.type} />}
            meta={String(t.itemCount)}
            onSelect={() => onSelect({ kind: 'template', id: t.id, name: t.name, type: t.type })}
          />
        ))}
      </div>
      {creating === 'template' ? (
        <NewTemplateForm
          online={online}
          initialType={newTemplateType}
          onCancel={() => setCreating(null)}
          onCreated={(t) => {
            void qc.invalidateQueries({ queryKey: qk.templates });
            onSelect({ kind: 'template', id: t.id, name: t.name, type: t.type });
          }}
        />
      ) : (
        <AddRow label="New template" disabled={!online} onClick={() => setCreating('template')} />
      )}
    </section>
  );

  return (
    <div className="space-y-4 pt-1">
      {listsError && (
        <p className="flex flex-wrap items-center gap-1 text-sm text-danger">
          Couldn't load your lists.
          <button
            type="button"
            onClick={onRetry}
            className="min-h-tap rounded-sm px-2 font-semibold underline"
          >
            Try again
          </button>
        </p>
      )}
      <div role="radiogroup" aria-label="Add to" className="flex flex-col gap-4">
        {templatesFirst ? tplSection : listsSection}
        {templatesFirst ? listsSection : tplSection}
      </div>
    </div>
  );
}

function PickerRow({
  selected,
  name,
  badge,
  meta,
  onSelect,
}: {
  selected: boolean;
  name: string;
  badge: React.ReactNode;
  meta: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-primary w-full items-center gap-2 rounded-md border-2 px-3 text-left ${
        selected ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        {selected && <Check aria-hidden className="h-5 w-5 text-accent" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-lg">{name}</span>
      {badge}
      <span className="shrink-0 text-sm font-bold tabular-nums text-muted">{meta}</span>
    </button>
  );
}

function AddRow({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={() => !disabled && onClick()}
      className={`mt-2 flex min-h-primary w-full items-center gap-2 rounded-md px-3 text-lg font-semibold text-accent ${
        disabled ? 'opacity-40' : 'active:bg-accent-soft'
      }`}
    >
      <Plus aria-hidden className="h-6 w-6" />
      {label}
    </button>
  );
}

function NameField({
  label,
  value,
  onChange,
  error,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-primary w-full rounded-md border-2 bg-surface px-3 text-lg ${
          error ? 'border-danger' : 'border-border'
        } focus:border-accent`}
      />
      {error && (
        <p id={`${id}-err`} className="mt-1 flex items-start gap-1 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function NewListForm({
  online,
  onCancel,
  onCreated,
}: {
  online: boolean;
  onCancel: () => void;
  onCreated: (list: ListSummary) => void;
}) {
  const [name, setName] = useState(() => defaultListName(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const msg = nameError(name, 'list');
    setError(msg);
    if (msg) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await createList({ name: name.trim() });
      onCreated(summaryOf(res.list));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border-subtle p-3">
      <NameField label="List name" value={name} onChange={setName} error={error} autoFocus />
      {failed && (
        <p role="alert" className="text-sm text-danger">
          Couldn't create that list. Please try again.
        </p>
      )}
      <Button
        busy={busy}
        busyLabel="Creating..."
        aria-disabled={!online}
        onClick={() => online && void submit()}
      >
        Create and select
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function NewTemplateForm({
  online,
  initialType,
  onCancel,
  onCreated,
}: {
  online: boolean;
  initialType: TemplateType;
  onCancel: () => void;
  onCreated: (t: { id: string; name: string; type: TemplateType }) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateType>(initialType);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const msg = nameError(name, 'template');
    setError(msg);
    if (msg) return;
    setBusy(true);
    setFailed(false);
    try {
      const t = await createTemplate({ name: name.trim(), type });
      onCreated(t);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border-subtle p-3">
      <NameField
        label="Template name"
        value={name}
        onChange={setName}
        error={error}
        placeholder="e.g. Tacos"
        autoFocus
      />
      <div>
        <p className="mb-1 text-sm font-semibold">Type</p>
        <SegmentedControl
          label="Template type"
          columns={3}
          options={TEMPLATE_TYPES}
          value={type}
          onChange={setType}
          optionLabel={(t) => TEMPLATE_TYPE_LABELS[t]}
        />
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          Couldn't create that template. Please try again.
        </p>
      )}
      <Button
        busy={busy}
        busyLabel="Creating..."
        aria-disabled={!online}
        onClick={() => online && void submit()}
      >
        Create and select
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
