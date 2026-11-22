import type { AuthService } from '../auth/types';

/**
 * Stand-in for `src/auth/service` in component tests that call the mock API. Kept free of
 * app imports so `vi.mock('../auth/service', ...)` can load it without a cycle:
 *   vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);
 */
export const authHolder: { auth: AuthService | null } = { auth: null };
export const serviceMock = {
  getAuth: () => {
    if (!authHolder.auth) throw new Error('test auth not set');
    return authHolder.auth;
  },
  initAuth: () => authHolder.auth,
};
