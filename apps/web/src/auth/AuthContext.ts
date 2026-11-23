import { createContext } from 'react';
import type { AuthUser, ResetPasswordResult, SignInResult } from './types';

export type AuthStatus = 'loading' | 'signedOut' | 'newPasswordRequired' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  /** Set when status is 'signedIn'. */
  user: AuthUser | null;
  /** Session restore failed only because of the network (Splash offers Try again). */
  restoreFailed: boolean;
  retryRestore(): void;
  signIn(email: string, password: string): Promise<SignInResult>;
  completeNewPassword(newPassword: string): Promise<SignInResult>;
  resetPassword(email: string): Promise<ResetPasswordResult>;
  confirmResetPassword(email: string, code: string, newPassword: string): Promise<void>;
  /** Signs out and clears all cached query data. */
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
