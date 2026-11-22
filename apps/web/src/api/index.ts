import type { MeResponse } from '@trolley/core';
import { getAuth } from '../auth/service';
import { MOCK_AUTH } from '../env';
import { createApiClient } from './client';
import { mockFetch } from './mock';

export { ApiError, createApiClient, type ApiClient } from './client';

/** App-wide API client. Uses the in-browser mock when VITE_MOCK_AUTH=true. */
export const api = createApiClient({
  getIdToken: () => getAuth().getIdToken(),
  ...(MOCK_AUTH ? { fetchImpl: mockFetch } : {}),
});

export const getMe = () => api.get<MeResponse>('/me');
