import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';

type Variant = 'error' | 'success' | 'info';

const STYLES: Record<Variant, string> = {
  error: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  info: 'bg-accent-soft text-text',
};

/** Form-level message. Errors are announced immediately (role="alert"), others politely. */
export function Banner({
  variant,
  children,
  className = '',
}: {
  variant: Variant;
  children: ReactNode;
  className?: string;
}) {
  const Icon = variant === 'error' ? CircleAlert : variant === 'success' ? CircleCheck : Info;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-sm px-3 py-3 text-sm font-semibold ${STYLES[variant]} ${className}`}
    >
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
