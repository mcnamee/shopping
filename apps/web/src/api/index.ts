import type {
  CreateCustomProductRequest,
  CreateCustomProductResponse,
  GroupsResponse,
  MeResponse,
  ProductSearchResponse,
} from '@trolley/core';
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

export interface SearchParams {
  q: string;
  category?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export const searchProducts = (params: SearchParams, signal?: AbortSignal) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  return api.get<ProductSearchResponse>(
    `/products/search?${qs.toString()}`,
    signal ? { signal } : {},
  );
};

export const getGroups = () => api.get<GroupsResponse>('/groups');

export const createCustomProduct = (body: CreateCustomProductRequest) =>
  api.post<CreateCustomProductResponse>('/products/custom', body);
