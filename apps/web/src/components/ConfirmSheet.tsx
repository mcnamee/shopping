import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmSheetProps {
  title: string;
  description: string;
  confirm: ReactNode;
  cancel: ReactNode;
  /** Locks the sheet (no Esc/scrim dismissal) while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

/**
 * Bottom-sheet confirmation (docs/ux/app-shell.md "Sign out confirm"): alertdialog, focus
 * trapped, initial focus on Cancel, Esc / scrim tap / Cancel closes. Focus returns to the
 * element that opened it.
 */
export function ConfirmSheet({
  title,
  description,
  confirm,
  cancel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const titleId = useId();
  const descId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !sheet.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !sheet.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onKeyDown={onKeyDown}>
      <div
        data-testid="scrim"
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={sheet}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full rounded-t-lg bg-surface-raised px-4 pb-[calc(var(--safe-bottom)+16px)] pt-3 shadow-sheet"
      >
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-subtle" />
        <h2 id={titleId} className="text-xl">
          {title}
        </h2>
        <p id={descId} className="mb-5 mt-1 text-base text-muted">
          {description}
        </p>
        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex min-h-primary w-full items-center justify-center gap-2 rounded-md bg-danger px-4 text-lg text-danger-on disabled:opacity-70"
          >
            {confirm}
          </button>
          <button
            ref={cancelButton}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex min-h-primary w-full items-center justify-center rounded-md border-2 border-border px-4 text-lg text-text disabled:opacity-70"
          >
            {cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
