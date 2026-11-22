import { CloudOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { Button } from './Button';

/** Centred empty state: icon on an accent-soft circle, heading, body and optional actions. */
export function EmptyView({
  Icon,
  title,
  children,
  body,
  headingRef,
}: {
  Icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col items-center px-2 pb-6 pt-12 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon aria-hidden size={48} />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="mt-5 text-xl focus:outline-none">
        {title}
      </h2>
      {body && <p className="mt-2 max-w-[300px] text-base text-muted">{body}</p>}
      {children && <div className="mt-6 flex w-full max-w-[358px] flex-col gap-3">{children}</div>}
    </div>
  );
}

/** Load failure with "Try again" (stage-2 I2: never a blank page). */
export function ErrorView({
  title,
  error,
  onRetry,
  children,
}: {
  title: string;
  error?: unknown;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const unreachable = error !== undefined && !(error instanceof ApiError);
  return (
    <div className="flex flex-col items-center px-2 pb-6 pt-12 text-center">
      <div role="alert" className="flex flex-col items-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-danger-soft text-danger">
          <CloudOff aria-hidden size={48} />
        </div>
        <h2 className="mt-5 text-xl">{title}</h2>
        <p className="mt-2 max-w-[300px] text-base text-muted">
          {unreachable
            ? "Can't reach Trolley right now."
            : 'Something went wrong. Please try again.'}
        </p>
      </div>
      <div className="mt-6 flex w-full max-w-[358px] flex-col gap-3">
        <Button onClick={onRetry}>Try again</Button>
        {children}
      </div>
    </div>
  );
}

/** A grey shimmer block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`shimmer rounded-sm ${className}`} />;
}
