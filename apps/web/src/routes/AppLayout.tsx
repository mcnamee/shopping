import { LayoutTemplate, ListChecks, Search, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

const tabs = [
  { to: '/', label: 'Lists', Icon: ListChecks },
  { to: '/search', label: 'Search', Icon: Search },
  { to: '/templates', label: 'Templates', Icon: LayoutTemplate },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const;

/** Placeholder shell with bottom navigation. Replace per docs/ux. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 p-4">
        <Outlet />
      </main>
      <nav aria-label="Main" className="sticky bottom-0 grid grid-cols-4 border-t bg-white">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center text-xs ${isActive ? 'font-semibold' : ''}`
            }
          >
            <Icon aria-hidden size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
