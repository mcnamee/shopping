import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth';
import { createMockAuth } from '../auth/mock';
import type { AuthService } from '../auth/types';
import { ToastProvider } from '../components/Toast';

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Mock auth with no latency and in-memory storage. */
export const makeAuth = (): AuthService =>
  createMockAuth({ storage: memoryStorage(), latencyMs: 0 });

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

export function renderApp(
  path: string,
  options: { auth?: AuthService; userEvent?: Parameters<typeof userEvent.setup>[0] } = {},
) {
  const auth = options.auth ?? makeAuth();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup(options.userEvent);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={auth}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <AppRoutes />
            <LocationProbe />
          </ToastProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, auth, user, pathname: () => result.getByTestId('pathname').textContent };
}
