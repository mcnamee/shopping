import type { AppConfig } from '../config';
import { MOCK_AUTH } from '../env';
import { createAmplifyAuth } from './amplify';
import { createMockAuth } from './mock';
import type { AuthService } from './types';

let service: AuthService | null = null;

/** Call once at startup (src/main.tsx) before rendering. */
export function initAuth(config: AppConfig): AuthService {
  service = MOCK_AUTH ? createMockAuth() : createAmplifyAuth(config);
  return service;
}

/** The configured auth service. Prefer `useAuth()` inside React components. */
export function getAuth(): AuthService {
  if (!service) throw new Error('initAuth() has not been called');
  return service;
}
