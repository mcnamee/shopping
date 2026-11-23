/** Shape of `location.state` passed between auth screens. */
export interface AuthRouteState {
  email?: string;
  notice?: 'session-timeout' | 'reset-success' | 'reset-required';
  /** Where to go after sign-in (set by RequireAuth). */
  from?: string;
}

const RETURN_PATHS = new Set(['/search', '/templates']);

/**
 * Where to land after signing in. Deep links to a tab are honoured; everything else
 * (including /settings, where sign-out happens) goes to Lists.
 */
export function returnPath(from: string | undefined): string {
  if (from && RETURN_PATHS.has(from)) return from;
  if (from && CONNECT_PATH.test(from)) return from;
  return pendingConnectPath() ?? '/';
}

const CONNECT_PATH = /^\/connect\?request=[\w-]{1,128}$/;
const PENDING_KEY = 'trolley.connect.pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Remembers a /connect?request=<id> link across sign-in (incl. the new-password step) in
 * sessionStorage, so the consent screen is where the person lands afterwards.
 */
export function rememberConnectPath(path: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // storage blocked: the route state still carries it for the plain sign-in case
  }
}

export function pendingConnectPath(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path: string; at: number };
    if (Date.now() - at > PENDING_TTL_MS || !CONNECT_PATH.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}

export function clearPendingConnect(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
