import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorisedHandler } from '../api/client';
import {
  clearOfflineData,
  hasCachedLists,
  readPersistedUser,
  restoreCache,
  savePersistedUser,
  setPersistUser,
} from '../offline/cachePersist';
import { resetTickQueue } from '../offline/tickQueue';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';
import { AuthError, type AuthService, type AuthUser, type SignInResult } from './types';

export function AuthProvider({ auth, children }: { auth: AuthService; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const [restoreFailed, setRestoreFailed] = useState(false);
  const [offlineSession, setOfflineSession] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const current = await auth.getCurrentUser();
      setRestoreFailed(false);
      setOfflineSession(false);
      if (current) {
        // Warm the cache before the app renders, so a list opened before shows at once.
        restoreCache(queryClient, current.userId);
        savePersistedUser(current);
        setPersistUser(current.userId);
      } else {
        setPersistUser(null);
        clearOfflineData();
        resetTickQueue();
      }
      setUser(current);
      setStatus(current ? 'signedIn' : 'signedOut');
    } catch (err) {
      if (!(err instanceof AuthError && err.code === 'NETWORK')) throw err;
      // B-001: the session could not be checked, only because of the network. With a remembered
      // user and a cached list, shop offline (read-only, ticks queue); otherwise offer Try again.
      const remembered = readPersistedUser();
      if (remembered && hasCachedLists(remembered.userId)) {
        restoreCache(queryClient, remembered.userId);
        setPersistUser(remembered.userId);
        setUser(remembered);
        setOfflineSession(true);
        setStatus('signedIn');
      } else {
        setRestoreFailed(true);
      }
    }
  }, [auth, queryClient]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const retryRestore = useCallback(() => {
    setRestoreFailed(false);
    void refreshUser();
  }, [refreshUser]);

  // Back online after an offline start: check the session for real.
  useEffect(() => {
    if (!offlineSession) return;
    const onOnline = () => void refreshUser().catch(() => undefined);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineSession, refreshUser]);

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
      setPersistUser(null);
      clearOfflineData();
      resetTickQueue();
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
      restoreFailed,
      retryRestore,
      signIn: async (email, password) => applySignInResult(await auth.signIn(email, password)),
      completeNewPassword: async (newPassword) =>
        applySignInResult(await auth.completeNewPassword(newPassword)),
      resetPassword: (email) => auth.resetPassword(email),
      confirmResetPassword: (email, code, newPassword) =>
        auth.confirmResetPassword(email, code, newPassword),
      signOut,
    }),
    [status, user, restoreFailed, retryRestore, auth, applySignInResult, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
