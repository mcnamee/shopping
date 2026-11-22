import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'danger-outline';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on active:bg-accent-strong',
  secondary: 'border-2 border-border bg-transparent text-text active:bg-accent-soft',
  danger: 'bg-danger text-danger-on active:opacity-90',
  'danger-outline': 'border-2 border-danger bg-transparent text-danger active:bg-danger-soft',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner and `busyLabel` and disables the button. */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

/** Full-width 56px button (docs/ux/tokens.md: tap-primary). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    busy = false,
    busyLabel,
    children,
    className = '',
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={`flex min-h-primary w-full items-center justify-center gap-2 rounded-md px-4 text-lg transition-colors disabled:opacity-70 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? (
        <>
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
});
