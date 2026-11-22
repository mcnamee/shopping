import { useQuery } from '@tanstack/react-query';
import { LayoutTemplate, ListChecks, Search, Settings, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ApiError, getMe } from '../api';
import { StatusBanner, type StatusBannerVariant } from '../components/StatusBanner';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { NoHouseholdState } from './NoHouseholdState';

export const TABS: readonly { to: string; label: string; Icon: LucideIcon }[] = [
  { to: '/', label: 'Lists', Icon: ListChecks },
  { to: '/search', label: 'Search', Icon: Search },
  { to: '/templates', label: 'Templates', Icon: LayoutTemplate },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

/** Tab-title lookup for the app bar. Unknown paths fall back to Lists. */
const titleFor = (pathname: string) =>
  TABS.find((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))?.label ?? 'Lists';

/** Remembers each tab's scroll position across tab changes. */
function useTabScrollRestoration(pathname: string) {
  const positions = useRef(new Map<string, number>());
  const current = useRef(pathname);

  useEffect(() => {
    const onScroll = () => positions.current.set(current.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    current.current = pathname;
    window.scrollTo(0, positions.current.get(pathname) ?? 0);
  }, [pathname]);
}

/** Signed-in shell: fixed app bar, status banner, scrolling content, fixed bottom nav. */
export function AppLayout() {
  const { pathname } = useLocation();
  const title = titleFor(pathname);
  const { online, justReconnected } = useOnlineStatus();
  const [errorDismissed, setErrorDismissed] = useState(false);
  useTabScrollRestoration(pathname);

  // Gate on /me: it is the server's view of the household (never trust client claims).
  const me = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });
  const noHousehold =
    me.error instanceof ApiError && me.error.status === 403 && me.error.code === 'NO_HOUSEHOLD';
  const apiError = me.isError && !noHousehold;

  let banner: StatusBannerVariant | null = null;
  if (!online) banner = 'offline';
  else if (apiError && !errorDismissed)
    banner = me.error instanceof ApiError ? 'error' : 'unreachable';
  else if (justReconnected) banner = 'online';

  return (
    <div className="min-h-dvh bg-bg [--nav-height:calc(64px+max(var(--safe-bottom),8px))]">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-border-subtle bg-surface pt-safe-top">
        <div className="flex h-14 items-center pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]">
          <h1 className="min-w-0 flex-1 truncate text-xl">{title}</h1>
          <div className="h-11 w-11" aria-hidden />
        </div>
      </header>

      <div className="pt-[calc(var(--safe-top)+56px)]">
        {banner && (
          <StatusBanner
            variant={banner}
            onRetry={() => {
              setErrorDismissed(false);
              void me.refetch();
            }}
            onDismiss={() => setErrorDismissed(true)}
          />
        )}
        <main className="pb-[calc(var(--nav-height)+16px)] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))] pt-4">
          {noHousehold && pathname !== '/settings' ? <NoHouseholdState /> : <Outlet />}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border-subtle bg-surface pb-[max(var(--safe-bottom),8px)] pl-safe-left pr-safe-right"
      >
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => {
              if (pathname === to) window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={({ isActive }) =>
              `flex min-h-primary flex-col items-center justify-center gap-1 pt-1 text-xs active:bg-accent-soft ${
                isActive ? 'text-accent' : 'text-muted'
              } focus-visible:outline-offset-[-2px]`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full ${
                    isActive ? 'bg-accent-soft' : ''
                  }`}
                >
                  <Icon aria-hidden size={24} strokeWidth={isActive ? 2.5 : 2} />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
