import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  /** Extra content under the input, before the error (e.g. a rules checklist). */
  hint?: ReactNode;
  /** Control rendered inside the right edge of the input (e.g. show/hide). */
  trailing?: ReactNode;
  inputClassName?: string;
}

/** Labelled 56px input with inline error (docs/ux/auth.md shared layout). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, trailing, id, inputClassName = '', className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`block min-h-primary w-full rounded-md border-2 bg-surface px-3 text-base text-text read-only:opacity-80 ${
            error ? 'border-danger' : 'border-border'
          } ${trailing ? 'pr-14' : ''} ${inputClassName}`}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error && (
        <p id={errorId} className="mt-1 flex items-start gap-1 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {hint}
    </div>
  );
});

/**
 * Password input with a 44px show/hide toggle. Toggling keeps focus and caret in the
 * input. `shown` is controlled so a form can re-hide the password after submit.
 */
export const PasswordField = forwardRef<
  HTMLInputElement,
  Omit<TextFieldProps, 'type' | 'trailing'> & {
    shown: boolean;
    onShownChange: (shown: boolean) => void;
  }
>(function PasswordField({ shown, onShownChange, ...rest }, ref) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);

  const toggle = () => {
    const el = inner.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    onShownChange(!shown);
    // Re-focus after the type attribute flips so the caret does not jump.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      if (start !== null && end !== null) el.setSelectionRange(start, end);
    });
  };

  return (
    <TextField
      ref={inner}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          // Keep focus in the input on pointer press.
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
          className="flex h-11 w-11 items-center justify-center rounded-sm text-muted"
        >
          {shown ? (
            <EyeOff aria-hidden className="h-5 w-5" />
          ) : (
            <Eye aria-hidden className="h-5 w-5" />
          )}
        </button>
      }
      {...rest}
    />
  );
});
