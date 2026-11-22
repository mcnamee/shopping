import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Splash } from '../components/Splash';
import { useAuth } from '../auth';
import { returnPath, type AuthRouteState } from './routeState';

/** Guards app routes: splash while restoring the session, else redirect to /sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Splash />;
  if (status !== 'signedIn') {
    const state: AuthRouteState = { from: location.pathname };
    return <Navigate to="/sign-in" replace state={state} />;
  }
  return <>{children}</>;
}

/** Guards auth screens: splash while restoring, signed-in users are sent into the app. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Splash />;
  if (status === 'signedIn') {
    const from = (location.state as AuthRouteState | null)?.from;
    return <Navigate to={returnPath(from)} replace />;
  }
  return <>{children}</>;
}
