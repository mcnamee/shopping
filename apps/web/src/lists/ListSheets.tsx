import {
  ENTITY_NAME_MAX_LENGTH,
  sortTemplates,
  type ListDetail,
  type TemplateSummary,
} from '@trolley/core';
import {
  CircleAlert,
  CircleCheck,
  LayoutTemplate,
  Pencil,
  Repeat,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { TypeBadge } from '../components/TypeBadge';

export function SheetHeader({
  id,
  title,
  headingRef,
  onClose,
}: {
  id: string;
  title: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pb-2">
      <h2
        id={id}
        ref={headingRef}
        tabIndex={-1}
        className="min-w-0 flex-1 truncate text-xl focus:outline-none"
      >
        {title}
      </h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
      >
        <X aria-hidden className="h-6 w-6" />
      </button>
    </div>
  );
}

function OptionRow({
  Icon,
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  Icon: typeof Pencil;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-disabled={disabled || undefined}
        className={`flex min-h-14 w-full items-center gap-4 rounded-sm px-2 text-left text-lg active:bg-accent-soft ${
          danger ? 'text-danger' : disabled ? 'text-muted' : 'text-text'
        }`}
      >
        <Icon aria-hidden className="h-6 w-6 shrink-0" />
        {children}
      </button>
    </li>
  );
}

interface OptionsSheetProps {
  list: ListDetail;
  onClose: () => void;
  onRename: () => void;
  onSetThisWeek: () => void;
  onAddFromTemplate: () => void;
  onSuggest: () => void;
  /** Set when the household has a Regulars template. */
  onRegulars?: () => void;
  /** Suggestions need the server: the row is aria-disabled while offline. */
  offline?: boolean;
  onFinish: () => void;
  onDelete: () => void;
}

/** Overflow menu of shop mode (docs/ux/lists.md 3.7). */
export function ListOptionsSheet(p: OptionsSheetProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const allTicked = p.list.items.length > 0 && p.list.items.every((i) => i.ticked);
  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      onClose={p.onClose}
      header={
        <SheetHeader id={headingId} title={p.list.name} headingRef={heading} onClose={p.onClose} />
      }
    >
      <ul>
        <OptionRow Icon={Pencil} onClick={p.onRename}>
          Rename list
        </OptionRow>
        {p.list.thisWeek ? (
          <li className="flex min-h-14 items-center gap-4 px-2 text-lg text-muted">
            <CircleCheck aria-hidden className="h-6 w-6 shrink-0" />
            This is this week's list
          </li>
        ) : (
          <OptionRow Icon={Star} onClick={p.onSetThisWeek}>
            Set as this week
          </OptionRow>
        )}
        <OptionRow Icon={LayoutTemplate} onClick={p.onAddFromTemplate}>
          Add from template
        </OptionRow>
        <OptionRow Icon={Sparkles} disabled={!!p.offline} onClick={p.onSuggest}>
          Suggest items
        </OptionRow>
        {p.onRegulars && (
          <OptionRow Icon={Repeat} disabled={!!p.offline} onClick={p.onRegulars}>
            Review regulars
          </OptionRow>
        )}
        {!allTicked && (
          <OptionRow Icon={CircleCheck} onClick={p.onFinish}>
            Finish shop
          </OptionRow>
        )}
        <OptionRow Icon={Trash2} danger onClick={p.onDelete}>
          Delete list
        </OptionRow>
      </ul>
    </BottomSheet>
  );
}

/** Rename sheet (docs/ux/lists.md 3.7). Resolves with the new name or rejects to show the banner. */
export function RenameSheet({
  list,
  onSave,
  onClose,
}: {
  list: ListDetail;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const headingId = useId();
  const inputId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { online } = useOnlineStatus();
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async () => {
    const t = name.trim();
    const err = !t
      ? 'Enter a name for this list.'
      : t.length > ENTITY_NAME_MAX_LENGTH
        ? 'Keep it to 60 characters or fewer.'
        : null;
    setError(err);
    if (err || !online) {
      if (!online) setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await onSave(t);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={busy}
      onClose={onClose}
      header={
        <SheetHeader id={headingId} title="Rename list" headingRef={heading} onClose={onClose} />
      }
      footer={
        <>
          {failed && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              Couldn't rename that list. Please try again.
            </p>
          )}
          <Button busy={busy} busyLabel="Saving..." onClick={() => void save()}>
            Save
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="pt-1">
        <label htmlFor={inputId} className="mb-1 block text-sm font-semibold">
          Name
        </label>
        <input
          id={inputId}
          type="text"
          value={name}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={`min-h-primary w-full rounded-md border-2 bg-surface px-3 text-lg ${
            error ? 'border-danger' : 'border-border'
          } focus:border-accent`}
        />
        {error && (
          <p id={`${inputId}-err`} className="mt-1 flex items-start gap-1 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

/** Pick the template to review before adding it to this list (docs/ux/lists.md 3.7). */
export function AddFromTemplateSheet({
  templates,
  onPick,
  onClose,
}: {
  templates: readonly TemplateSummary[];
  onPick: (template: TemplateSummary) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      onClose={onClose}
      header={
        <SheetHeader
          id={headingId}
          title="Add from template"
          headingRef={heading}
          onClose={onClose}
        />
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {templates.length === 0 ? (
        <p className="py-2 text-base text-muted">You haven't made any templates yet.</p>
      ) : (
        <>
          <p className="pb-1 text-sm text-muted">Choose a template to review its items.</p>
          <ul aria-label="Templates" className="space-y-1">
            {sortTemplates(templates).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-sm px-1 text-left active:bg-surface"
                >
                  <span className="min-w-0 flex-1 truncate text-lg">{t.name}</span>
                  <TypeBadge type={t.type} />
                  <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-muted">
                    {t.itemCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}
