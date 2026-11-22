import { CloudOff, Plus, RefreshCw, Search, SearchX, WifiOff, type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { Button } from '../components/Button';

type Tone = 'accent' | 'danger' | 'warning';

const TONES: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning-text',
};

interface StateBlockProps {
  Icon: LucideIcon;
  tone?: Tone;
  heading: string;
  body?: string;
  alert?: boolean;
  children?: ReactNode;
}

/** Empty-state pattern from docs/ux/app-shell.md section 2 (icon circle, heading, body). */
export const StateBlock = forwardRef<HTMLHeadingElement, StateBlockProps>(function StateBlock(
  { Icon, tone = 'accent', heading, body, alert = false, children },
  ref,
) {
  return (
    <div className="flex flex-col items-center px-2 pb-6 pt-10 text-center">
      <div {...(alert ? { role: 'alert' } : {})} className="flex flex-col items-center">
        <div className={`flex h-24 w-24 items-center justify-center rounded-full ${TONES[tone]}`}>
          <Icon aria-hidden size={48} />
        </div>
        <h2 ref={ref} tabIndex={-1} className="mt-5 text-xl focus:outline-none">
          {heading}
        </h2>
        {body && <p className="mt-2 max-w-[280px] text-base text-muted">{body}</p>}
      </div>
      {children && <div className="mt-6 w-full">{children}</div>}
    </div>
  );
});

export function InitialState({ onCustom }: { onCustom: (button: HTMLButtonElement) => void }) {
  return (
    <StateBlock
      Icon={Search}
      heading="Find your ALDI items"
      body="Type a product name, or pick a category above to browse."
    >
      <Button
        variant="secondary"
        className="!border-accent !text-accent"
        onClick={(e) => onCustom(e.currentTarget)}
      >
        <Plus aria-hidden className="h-5 w-5" />
        Add a custom item
      </Button>
      <p className="mx-auto mt-6 max-w-[280px] text-sm text-muted">
        Your regular items will show up here after a few shops.
      </p>
    </StateBlock>
  );
}

interface NoResultsProps {
  query: string;
  categoryName: string | undefined;
  /** Browsing a category with no products. */
  browse: boolean;
  onCustom: (button: HTMLButtonElement) => void;
}

export function NoResultsState({ query, categoryName, browse, onCustom }: NoResultsProps) {
  if (browse) {
    return (
      <StateBlock
        Icon={SearchX}
        heading={`Nothing in ${categoryName ?? 'this category'} yet`}
        body="Products appear here after the next ALDI catalogue update."
      >
        <Button
          variant="secondary"
          className="!border-accent !text-accent"
          onClick={(e) => onCustom(e.currentTarget)}
        >
          <Plus aria-hidden className="h-5 w-5" />
          Add a custom item
        </Button>
      </StateBlock>
    );
  }
  const short = query.length > 24 ? `${query.slice(0, 24)}...` : query;
  return (
    <StateBlock
      Icon={SearchX}
      heading={`No matches for '${short}'`}
      body={`Check the spelling, try a shorter word${categoryName ? ', or pick "All" categories' : ''}.`}
    >
      <Button className="h-auto py-3" onClick={(e) => onCustom(e.currentTarget)}>
        <Plus aria-hidden className="h-5 w-5 shrink-0" />
        <span>{`Add '${short}' as a custom item`}</span>
      </Button>
    </StateBlock>
  );
}

export const ErrorState = forwardRef<
  HTMLHeadingElement,
  { unreachable: boolean; onRetry: () => void }
>(function ErrorState({ unreachable, onRetry }, ref) {
  return (
    <StateBlock
      ref={ref}
      Icon={CloudOff}
      tone="danger"
      alert
      heading="Couldn't load products"
      body={
        unreachable ? "Can't reach Trolley right now." : 'Something went wrong. Please try again.'
      }
    >
      <Button onClick={onRetry}>
        <RefreshCw aria-hidden className="h-5 w-5" />
        Try again
      </Button>
    </StateBlock>
  );
});

export function OfflineState({
  online,
  hasPrevious,
  onRetry,
}: {
  online: boolean;
  hasPrevious: boolean;
  onRetry: () => void;
}) {
  return (
    <StateBlock
      Icon={WifiOff}
      tone="warning"
      heading="You're offline"
      body={`Search needs a connection.${hasPrevious ? ' Your last results are still here if you scroll up.' : ''}`}
    >
      <Button disabled={!online} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-5 w-5" />
        Try again
      </Button>
    </StateBlock>
  );
}
