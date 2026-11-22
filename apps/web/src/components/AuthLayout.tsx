import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

const BACK_CLASS =
  'inline-flex min-h-tap items-center gap-1 rounded-sm px-2 text-base font-semibold text-accent';

/** Shared auth screen layout (docs/ux/auth.md): single centred column, safe-area padding. */
export function AuthLayout({
  children,
  back,
}: {
  children: ReactNode;
  /** When set, shows a 44px back link instead of the logo block. */
  back?:
    | { to: string; label: string; state?: unknown }
    | { label: string; onClick: () => void; to?: undefined };
}) {
  return (
    <div className="min-h-dvh bg-bg pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pt-[calc(var(--safe-top)+16px)]">
      <main className="mx-auto w-full max-w-[400px]">
        {back ? (
          <div className="-ml-2 mb-4">
            {back.to !== undefined ? (
              <Link
                to={back.to}
                state={'state' in back ? back.state : undefined}
                className={BACK_CLASS}
              >
                <ArrowLeft aria-hidden className="h-5 w-5" />
                {back.label}
              </Link>
            ) : (
              <button type="button" onClick={back.onClick} className={BACK_CLASS}>
                <ArrowLeft aria-hidden className="h-5 w-5" />
                {back.label}
              </button>
            )}
          </div>
        ) : (
          <div className="h-8" />
        )}
        {children}
      </main>
    </div>
  );
}
