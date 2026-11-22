import { CircleAlert, Wifi, WifiOff, X } from 'lucide-react';

export type StatusBannerVariant = 'offline' | 'error' | 'unreachable' | 'online';

interface StatusBannerProps {
  variant: StatusBannerVariant;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const CONTENT = {
  offline: {
    Icon: WifiOff,
    text: "You're offline. Some things won't work until you're back online.",
    style: 'bg-warning-soft text-warning-text',
    role: 'status',
  },
  error: {
    Icon: CircleAlert,
    text: 'Something went wrong. Please try again.',
    style: 'bg-danger-soft text-danger',
    role: 'alert',
  },
  unreachable: {
    Icon: CircleAlert,
    text: "Can't reach Trolley right now.",
    style: 'bg-danger-soft text-danger',
    role: 'alert',
  },
  online: {
    Icon: Wifi,
    text: "You're back online.",
    style: 'bg-success-soft text-success',
    role: 'status',
  },
} as const;

/** Banner under the app bar (docs/ux/app-shell.md section 5). */
export function StatusBanner({ variant, onRetry, onDismiss }: StatusBannerProps) {
  const { Icon, text, style, role } = CONTENT[variant];
  const isError = variant === 'error' || variant === 'unreachable';
  return (
    <div
      role={role}
      className={`flex min-h-12 items-center gap-2 px-4 py-3 text-sm font-semibold ${style}`}
    >
      <Icon aria-hidden className="h-5 w-5 shrink-0" />
      <span className="flex-1">{text}</span>
      {isError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-tap rounded-sm px-2 font-semibold underline"
        >
          Try again
        </button>
      )}
      {isError && onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex h-11 w-11 items-center justify-center rounded-sm"
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
