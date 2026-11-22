export interface AuthUser {
  /** Cognito `sub`. */
  userId: string;
  email: string;
  /** From the `custom:householdId` claim. Missing means the account isn't set up yet. */
  householdId: string | null;
}

/** Outcome of signIn / completeNewPassword. */
export type SignInResult =
  | { status: 'SIGNED_IN' }
  /** Admin-created user signing in with the emailed temporary password. Call completeNewPassword. */
  | { status: 'NEW_PASSWORD_REQUIRED' }
  /** Admin forced a reset. Call resetPassword then confirmResetPassword. */
  | { status: 'RESET_PASSWORD_REQUIRED' }
  /** A Cognito step this app doesn't support (e.g. MFA) - show a generic error. */
  | { status: 'UNSUPPORTED_STEP'; step: string };

export interface ResetPasswordResult {
  /** Masked destination, e.g. "a***@e***", when Cognito reports it. */
  destination: string | null;
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TEMP_PASSWORD_EXPIRED'
  | 'PASSWORD_POLICY'
  | 'INVALID_CODE'
  | 'EXPIRED_CODE'
  | 'TOO_MANY_ATTEMPTS'
  | 'RESET_NOT_ALLOWED'
  | 'MISSING_INPUT'
  | 'ALREADY_SIGNED_IN'
  | 'NETWORK'
  | 'UNKNOWN';

/** All auth functions reject with this. Map `code` to Australian-English copy in the UI. */
export class AuthError extends Error {
  override name = 'AuthError';
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface AuthService {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Answers CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED (Amplify confirmSignIn). */
  completeNewPassword(newPassword: string): Promise<SignInResult>;
  /** Sends a reset code by email. */
  resetPassword(email: string): Promise<ResetPasswordResult>;
  confirmResetPassword(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<void>;
  /** Signed-in user from the (refreshed if needed) ID token, or null. */
  getCurrentUser(): Promise<AuthUser | null>;
  /** Cognito ID token (JWT) for the API's Authorization header, or null if signed out. */
  getIdToken(): Promise<string | null>;
}
