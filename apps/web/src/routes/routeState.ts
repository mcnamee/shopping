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
  return from && RETURN_PATHS.has(from) ? from : '/';
}
