/**
 * Mock auth for local development and Playwright (VITE_MOCK_AUTH=true). Never built
 * into production (vite.config.ts refuses to build with it on).
 *
 * Test accounts (any email not listed behaves like a normal user):
 *   - any email + "Password1"                -> signed in, householdId "mock-household"
 *   - new@example.com + "TempPass1"          -> NEW_PASSWORD_REQUIRED, then completeNewPassword
 *   - nohousehold@example.com + "Password1"  -> signed in, but no householdId (API returns 403)
 *   - reset@example.com + anything           -> RESET_PASSWORD_REQUIRED
 *   - expired@example.com + anything         -> TEMP_PASSWORD_EXPIRED error
 *   - locked@example.com + anything          -> TOO_MANY_ATTEMPTS error
 *   - any other password                     -> INVALID_CREDENTIALS error
 * Password reset: any email; code "123456" is accepted, anything else is INVALID_CODE.
 * New passwords must meet the Cognito policy (8+ chars, upper, lower, digit).
 *
 * The mock "ID token" is `mock.<base64url(JSON claims)>`; src/api/mock.ts decodes it.
 */
import { AuthError, type AuthService, type AuthUser } from './types';

export const MOCK_PASSWORD = 'Password1';
export const MOCK_TEMP_PASSWORD = 'TempPass1';
export const MOCK_RESET_CODE = '123456';
export const MOCK_HOUSEHOLD_ID = 'mock-household';
const STORAGE_KEY = 'trolley.mockAuth.user';

export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  );
}

function base64UrlEncode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function encodeMockToken(user: AuthUser): string {
  const claims: Record<string, string> = { sub: user.userId, email: user.email, token_use: 'id' };
  if (user.householdId) claims['custom:householdId'] = user.householdId;
  return `mock.${base64UrlEncode(JSON.stringify(claims))}`;
}

function makeUser(email: string): AuthUser {
  const normalised = email.trim().toLowerCase();
  return {
    userId: `mock-${normalised}`,
    email: normalised,
    householdId: normalised === 'nohousehold@example.com' ? null : MOCK_HOUSEHOLD_ID,
  };
}

export interface MockAuthOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Simulated network latency in ms so loading states are visible. */
  latencyMs?: number;
}

export function createMockAuth(options: MockAuthOptions = {}): AuthService {
  const storage = options.storage ?? globalThis.localStorage;
  const latency = options.latencyMs ?? 150;
  let pendingNewPasswordEmail: string | null = null;

  const delay = () => new Promise((resolve) => setTimeout(resolve, latency));

  const load = (): AuthUser | null => {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  };
  const save = (user: AuthUser) => storage.setItem(STORAGE_KEY, JSON.stringify(user));

  return {
    async signIn(email, password) {
      await delay();
      const e = email.trim().toLowerCase();
      if (!e || !password) throw new AuthError('MISSING_INPUT', 'Email and password are required');
      if (load()) throw new AuthError('ALREADY_SIGNED_IN', 'Already signed in');
      if (e === 'expired@example.com') {
        throw new AuthError(
          'TEMP_PASSWORD_EXPIRED',
          'Temporary password has expired and must be reset by an administrator.',
        );
      }
      if (e === 'locked@example.com') {
        throw new AuthError('TOO_MANY_ATTEMPTS', 'Password attempts exceeded');
      }
      if (e === 'reset@example.com') return { status: 'RESET_PASSWORD_REQUIRED' };
      if (e === 'new@example.com' && password === MOCK_TEMP_PASSWORD) {
        pendingNewPasswordEmail = e;
        return { status: 'NEW_PASSWORD_REQUIRED' };
      }
      if (password !== MOCK_PASSWORD) {
        throw new AuthError('INVALID_CREDENTIALS', 'Incorrect username or password.');
      }
      save(makeUser(e));
      return { status: 'SIGNED_IN' };
    },

    async completeNewPassword(newPassword) {
      await delay();
      if (!pendingNewPasswordEmail) throw new AuthError('UNKNOWN', 'No sign-in in progress');
      if (!meetsPasswordPolicy(newPassword)) {
        throw new AuthError('PASSWORD_POLICY', 'Password does not conform to policy');
      }
      save(makeUser(pendingNewPasswordEmail));
      pendingNewPasswordEmail = null;
      return { status: 'SIGNED_IN' };
    },

    async resetPassword(email) {
      await delay();
      if (!email.trim()) throw new AuthError('MISSING_INPUT', 'Email is required');
      return { destination: 'm***@e***' };
    },

    async confirmResetPassword(email, code, newPassword) {
      await delay();
      if (!email.trim() || !code.trim() || !newPassword) {
        throw new AuthError('MISSING_INPUT', 'All fields are required');
      }
      if (code.trim() !== MOCK_RESET_CODE) {
        throw new AuthError('INVALID_CODE', 'Invalid verification code provided');
      }
      if (!meetsPasswordPolicy(newPassword)) {
        throw new AuthError('PASSWORD_POLICY', 'Password does not conform to policy');
      }
    },

    async signOut() {
      await delay();
      pendingNewPasswordEmail = null;
      storage.removeItem(STORAGE_KEY);
    },

    async getCurrentUser() {
      const user = load();
      // Like an expired access token that cannot be refreshed without a network.
      if (user && globalThis.navigator?.onLine === false) {
        throw new AuthError('NETWORK', 'Network request failed');
      }
      return user;
    },

    async getIdToken() {
      const user = load();
      return user ? encodeMockToken(user) : null;
    },
  };
}
