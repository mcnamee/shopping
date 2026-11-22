import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorisedHandler } from '../api/client';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';
import type { AuthService, AuthUser, SignInResult } from './types';

export function AuthProvider({ auth, children }: { auth: AuthService; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refreshUser = useCallback(async () => {
    const current = await auth.getCurrentUser();
    setUser(current);
    setStatus(current ? 'signedIn' : 'signedOut');
  }, [auth]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const applySignInResult = useCallback(
    async (result: SignInResult) => {
      if (result.status === 'SIGNED_IN') await refreshUser();
      else if (result.status === 'NEW_PASSWORD_REQUIRED') setStatus('newPasswordRequired');
      return result;
    },
    [refreshUser],
  );

  // Local sign-out always succeeds: even if the network call fails, clear local state.
  const signOut = useCallback(async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.warn('Sign-out request failed; cleared local session anyway', err);
    } finally {
      queryClient.clear();
      setUser(null);
      setStatus('signedOut');
    }
  }, [auth, queryClient]);

  // A 401 from the API means the session is gone (refresh token expired or revoked).
  useEffect(() => {
    setUnauthorisedHandler(() => void signOut());
    return () => setUnauthorisedHandler(null);
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signIn: async (email, password) => applySignInResult(await auth.signIn(email, password)),
      completeNewPassword: async (newPassword) =>
        applySignInResult(await auth.completeNewPassword(newPassword)),
      resetPassword: (email) => auth.resetPassword(email),
      confirmResetPassword: (email, code, newPassword) =>
        auth.confirmResetPassword(email, code, newPassword),
      signOut,
    }),
    [status, user, auth, applySignInResult, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
