// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Splash } from '../components/Splash';
import { saveCache, savePersistedUser } from '../offline/cachePersist';
import { AuthProvider } from './AuthProvider';
import { AuthError, type AuthService, type AuthUser } from './types';
import { useAuth } from './useAuth';

const USER: AuthUser = { userId: 'u1', email: 'a@b.c', householdId: 'h' };

function Probe() {
  const { status } = useAuth();
  return status === 'loading' ? <Splash /> : <p>status:{status}</p>;
}

function setup(getCurrentUser: AuthService['getCurrentUser']) {
  const auth = { getCurrentUser, getIdToken: async () => null } as unknown as AuthService;
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider auth={auth}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const network = () => Promise.reject(new AuthError('NETWORK', 'offline'));

beforeEach(() => localStorage.clear());

describe('session restore without a network (B-001)', () => {
  it('shows "Can\'t reach Trolley right now" with Try again, then recovers', async () => {
    const get = vi.fn<AuthService['getCurrentUser']>().mockImplementationOnce(network);
    get.mockResolvedValue(USER);
    setup(get);
    expect(await screen.findByText("Can't reach Trolley right now.")).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('status:signedIn')).toBeVisible();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('lets a remembered user with a cached list in, offline', async () => {
    const seed = new QueryClient();
    seed.setQueryData(['lists'], { lists: [] });
    savePersistedUser(USER);
    saveCache(seed, USER.userId);
    setup(vi.fn<AuthService['getCurrentUser']>(network));
    expect(await screen.findByText('status:signedIn')).toBeVisible();
  });

  it('does not let a remembered user in without a cached list', async () => {
    savePersistedUser(USER);
    setup(vi.fn<AuthService['getCurrentUser']>(network));
    expect(await screen.findByText("Can't reach Trolley right now.")).toBeVisible();
  });

  it('a genuinely missing session is still signed out and clears remembered data', async () => {
    savePersistedUser(USER);
    setup(vi.fn<AuthService['getCurrentUser']>().mockResolvedValue(null));
    expect(await screen.findByText('status:signedOut')).toBeVisible();
    await waitFor(() => expect(localStorage.getItem('trolley.offline.user.v1')).toBeNull());
  });
});
