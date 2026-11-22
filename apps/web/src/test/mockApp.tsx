import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth';
import type { AuthService } from '../auth/types';
import { clearListOverlay } from '../lists/data';
import { ToastProvider } from '../components/Toast';
import { authHolder } from './authService';
import { makeAuth } from './render';

/**
 * Component tests against the real in-browser mock API (src/api/mock.ts) instead of
 * hand-rolled stubs: the same core rules the server uses, state in jsdom's localStorage.
 * Test files mock the auth service with ./authService (see there).
 */
/** Fresh mock data, fetch routed to the mock API. Call in `beforeEach`. */
export async function installMockApi() {
  const { mockFetch, resetMockApi } = await import('../api/mock');
  resetMockApi();
  clearListOverlay();
  (globalThis as { __mockApiFail?: unknown }).__mockApiFail = null;
  vi.stubGlobal('fetch', mockFetch);
  const auth = makeAuth();
  await auth.signIn('alex@example.com', 'Password1');
  authHolder.auth = auth;
  return auth;
}

export function failNext(match: string, status = 500, times = 1) {
  (globalThis as { __mockApiFail?: unknown }).__mockApiFail = { match, status, times };
}

/** Wrap a component in the providers the app uses. */
export function renderWithProviders(ui: React.ReactElement, auth: AuthService) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={auth}>
        <MemoryRouter>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, queryClient };
}

/** Full app at `path`, signed in against the mock API. */
export async function renderMockApp(
  path: string,
  opts: { fail?: { match: string; status?: number; times?: number } } = {},
) {
  const auth = await installMockApi();
  if (opts.fail) failNext(opts.fail.match, opts.fail.status, opts.fail.times);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={auth}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, queryClient };
}

/** Call the mock API directly as the signed-in user (e.g. "the other phone" changing data). */
export async function callMock<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const { mockFetch } = await import('../api/mock');
  const token = await authHolder.auth?.getIdToken();
  const res = await mockFetch(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
