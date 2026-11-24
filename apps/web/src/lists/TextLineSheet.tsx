import { DEFAULT_GROUPS, TEXT_LINE_MAX_LENGTH, type ListItem } from '@trolley/core';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type RefObject } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { SheetHeader } from './ListSheets';

export interface TextLineEdit {
  text: string;
  groupId: string;
  note: string;
}

/**
 * Edit sheet for a free-text line (docs/stages/stage-5.md G1): text, group and note; no
 * quantity or unit. Resolves to close; rejects to show the banner.
 */
export function TextLineSheet({
  item,
  onSave,
  onRemove,
  onClose,
  returnFocusRef,
}: {
  item: ListItem;
  onSave: (edit: TextLineEdit) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const headingId = useId();
  const groupId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [text, setText] = useState(item.product.name);
  const [group, setGroup] = useState(item.product.groupId);
  const [note, setNote] = useState(item.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const save = async () => {
    const t = text.trim().replace(/\s+/g, ' ');
    const err = !t
      ? 'Enter some text for this line.'
      : t.length > TEXT_LINE_MAX_LENGTH
        ? `Keep it to ${TEXT_LINE_MAX_LENGTH} characters or fewer.`
        : null;
    setError(err);
    if (err) return;
    setBusy(true);
    setFailed(null);
    try {
      await onSave({ text: t, groupId: group, note: note.trim() });
    } catch (e) {
      setBusy(false);
      setFailed(e instanceof Error && e.message ? e.message : "Couldn't save. Please try again.");
    }
  };

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      busy={busy}
      onClose={onClose}
      header={
        <SheetHeader id={headingId} title="Edit line" headingRef={heading} onClose={onClose} />
      }
      footer={
        <>
          {failed && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              {failed}
            </p>
          )}
          <Button busy={busy} busyLabel="Saving..." onClick={() => void save()}>
            Save
          </Button>
          <Button variant="danger-outline" disabled={busy} onClick={onRemove}>
            <Trash2 aria-hidden className="h-5 w-5" />
            Remove from list
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <TextField
          label="Text"
          value={text}
          error={error}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <div>
          <label htmlFor={groupId} className="mb-1 block text-sm font-semibold">
            Group
          </label>
          <select
            id={groupId}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="block min-h-primary w-full rounded-md border-2 border-border bg-surface px-3 text-base text-text"
          >
            {DEFAULT_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label="Note"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </BottomSheet>
  );
}
