import { useQueryClient } from '@tanstack/react-query';
import { ENTITY_NAME_MAX_LENGTH, type ListDetail, type TemplateSummary } from '@trolley/core';
import { CircleAlert, CircleCheck, LayoutTemplate, Pencil, Star, Trash2, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { TemplateChecklist } from './TemplateChecklist';
import { ROLLBACK_MESSAGE } from './data';
import { addTemplates } from './templateAdd';

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
}: {
  Icon: typeof Pencil;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-14 w-full items-center gap-4 rounded-sm px-2 text-left text-lg active:bg-accent-soft ${
          danger ? 'text-danger' : 'text-text'
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

/** Add template(s) to this list (docs/ux/lists.md 3.7; same merge rule D-046). */
export function AddFromTemplateSheet({
  list,
  templates,
  onClose,
}: {
  list: { id: string; name: string };
  templates: readonly TemplateSummary[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { online } = useOnlineStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const add = async () => {
    if (!online || selected.size === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const { message, options } = await addTemplates(qc, list.id, list.name, [...selected], () =>
        toast.show("Couldn't undo. Check your connection."),
      );
      toast.show(message, options);
      onClose();
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
        <SheetHeader
          id={headingId}
          title="Add from template"
          headingRef={heading}
          onClose={onClose}
        />
      }
      footer={
        <>
          {failed && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              {ROLLBACK_MESSAGE}
            </p>
          )}
          <Button
            busy={busy}
            busyLabel="Adding..."
            aria-disabled={selected.size === 0 || !online}
            onClick={() => void add()}
          >
            Add to list
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      {templates.length === 0 ? (
        <p className="py-2 text-base text-muted">You haven't made any templates yet.</p>
      ) : (
        <>
          <TemplateChecklist
            templates={templates}
            selected={selected}
            onToggle={(id) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
          />
          <p className="mt-1 text-sm text-muted">
            Matching items are combined, so you won't get doubles.
          </p>
        </>
      )}
    </BottomSheet>
  );
}
