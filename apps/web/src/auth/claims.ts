import type { AuthUser } from './types';

/** Build an AuthUser from decoded ID-token claims. */
export function userFromClaims(claims: Record<string, unknown>): AuthUser | null {
  const sub = claims.sub;
  if (typeof sub !== 'string' || !sub) return null;
  const email = typeof claims.email === 'string' ? claims.email : '';
  const hh = claims['custom:householdId'];
  return { userId: sub, email, householdId: typeof hh === 'string' && hh ? hh : null };
}
