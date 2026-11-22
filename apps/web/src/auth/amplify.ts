import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  resetPassword,
  signIn,
  signOut,
  type SignInOutput,
} from 'aws-amplify/auth';
import type { AppConfig } from '../config';
import { userFromClaims } from './claims';
import { toAuthError } from './errors';
import type { AuthService, SignInResult } from './types';

function mapSignIn(output: SignInOutput): SignInResult {
  const step = output.nextStep.signInStep;
  switch (step) {
    case 'DONE':
      return { status: 'SIGNED_IN' };
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return { status: 'NEW_PASSWORD_REQUIRED' };
    case 'RESET_PASSWORD':
      return { status: 'RESET_PASSWORD_REQUIRED' };
    default:
      return { status: 'UNSUPPORTED_STEP', step };
  }
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAuthError(err);
  }
}

/** Cognito via Amplify v6 (USER_SRP_AUTH). Tokens are persisted by Amplify in localStorage. */
export function createAmplifyAuth(config: AppConfig): AuthService {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
      },
    },
  });

  const doSignIn = (email: string, password: string) =>
    signIn({ username: email.trim(), password, options: { authFlowType: 'USER_SRP_AUTH' } });

  return {
    signIn: (email, password) =>
      wrap(async () => {
        try {
          return mapSignIn(await doSignIn(email, password));
        } catch (err) {
          // A stale local session (e.g. refresh token expired) blocks a new sign-in.
          if (err instanceof Error && err.name === 'UserAlreadyAuthenticatedException') {
            await signOut();
            return mapSignIn(await doSignIn(email, password));
          }
          throw err;
        }
      }),

    completeNewPassword: (newPassword) =>
      wrap(async () => mapSignIn(await confirmSignIn({ challengeResponse: newPassword }))),

    resetPassword: (email) =>
      wrap(async () => {
        const out = await resetPassword({ username: email.trim() });
        const details =
          out.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE'
            ? out.nextStep.codeDeliveryDetails
            : undefined;
        return { destination: details?.destination ?? null };
      }),

    confirmResetPassword: (email, code, newPassword) =>
      wrap(() =>
        confirmResetPassword({
          username: email.trim(),
          confirmationCode: code.trim(),
          newPassword,
        }),
      ),

    signOut: () => wrap(() => signOut()),

    getCurrentUser: async () => {
      try {
        const session = await fetchAuthSession();
        const payload = session.tokens?.idToken?.payload;
        return payload ? userFromClaims(payload) : null;
      } catch {
        return null;
      }
    },

    getIdToken: async () => {
      try {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString() ?? null;
      } catch {
        return null;
      }
    },
  };
}
