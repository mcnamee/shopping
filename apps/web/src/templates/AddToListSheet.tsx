import { useQueryClient } from '@tanstack/react-query';
import { sortActiveLists, type ListSummary, type Template } from '@trolley/core';
import { Check, CircleAlert, ListPlus, Plus, Star } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { ROLLBACK_MESSAGE } from '../lists/data';
import { SheetHeader } from '../lists/ListSheets';
import { addTemplates } from '../lists/templateAdd';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { truncate } from '../search/format';

interface AddToListSheetProps {
  template: Pick<Template, 'id' | 'name'>;
  lists: readonly ListSummary[];
  onNewList: () => void;
  onClose: () => void;
}

/** "Add to a list" from a template (docs/ux/templates.md 2.2): radio rows of active lists. */
export function AddToListSheet({ template, lists, onNewList, onClose }: AddToListSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const sorted = sortActiveLists(lists);
  const [selectedId, setSelectedId] = useState<string | undefined>(sorted[0]?.id);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = sorted.find((l) => l.id === selectedId);

  const add = async () => {
    if (!target || !online) return;
    setBusy(true);
    setFailed(false);
    try {
      const { message, options } = await addTemplates(
        qc,
        target.id,
        target.name,
        [template.id],
        () => toast.show("Couldn't undo. Check your connection."),
        true,
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
        <SheetHeader id={headingId} title="Add to a list" headingRef={heading} onClose={onClose} />
      }
      footer={
        sorted.length === 0 ? (
          <Button onClick={onNewList}>
            <Plus aria-hidden className="h-5 w-5" />
            New list
          </Button>
        ) : (
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
              aria-disabled={!online}
              aria-label={`Add to ${target?.name ?? 'list'}`}
              onClick={() => void add()}
            >
              Add to {truncate(target?.name ?? 'list', 20)}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </>
        )
      }
    >
      {sorted.length === 0 ? (
        <p className="py-2 text-base text-muted">You don't have a list yet.</p>
      ) : (
        <div role="radiogroup" aria-label="Add to" className="space-y-2 pt-1">
          {sorted.map((l) => {
            const on = l.id === selectedId;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSelectedId(l.id)}
                className={`flex min-h-14 w-full items-center gap-2 rounded-md border-2 px-3 text-left ${
                  on ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {on && <Check aria-hidden className="h-5 w-5 text-accent" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-lg">{l.name}</span>
                {l.thisWeek && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                    <Star aria-hidden className="h-3.5 w-3.5" />
                    This week
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onNewList}
            className="flex min-h-14 w-full items-center gap-2 rounded-md px-3 text-lg font-semibold text-accent active:bg-accent-soft"
          >
            <ListPlus aria-hidden className="h-6 w-6" />
            New list
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
