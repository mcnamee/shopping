import type {
  AddItemRequest,
  AddTemplatesToListResponse,
  AisleOrderResponse,
  CreateCustomProductRequest,
  CreateCustomProductResponse,
  CreateListRequest,
  CreateListResponse,
  CreateTemplateRequest,
  EditItemRequest,
  GroupsResponse,
  HistoryResponse,
  ListArchiveResponse,
  ListDetail,
  ListItemDeleteResponse,
  ListItemMutationResponse,
  ListItemUpdateResponse,
  ListsResponse,
  ListSummary,
  MeResponse,
  ProductSearchResponse,
  Template,
  TemplateItemMutationResponse,
  TemplatesResponse,
  UnitOverrideResponse,
  UnitOverridesResponse,
  UnitType,
  UpdateListRequest,
  UpdateTemplateRequest,
} from '@trolley/core';
import { getAuth } from '../auth/service';
import { MOCK_AUTH } from '../env';
import { createApiClient } from './client';

/** The mock API loads on first use, so production bundles never fetch it (only mock mode calls it). */
const lazyMockFetch: typeof fetch = async (input, init) =>
  (await import('./mock')).mockFetch(input, init);

export { ApiError, createApiClient, type ApiClient } from './client';

/** App-wide API client. Uses the in-browser mock when VITE_MOCK_AUTH=true. */
export const api = createApiClient({
  getIdToken: () => getAuth().getIdToken(),
  ...(MOCK_AUTH ? { fetchImpl: lazyMockFetch } : {}),
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

// ------------------------------------------------------------------ Stage 2 (docs/api.md)
// 409 responses carry { code: 'CONFLICT', reason, current? } in ApiError.body.

const enc = encodeURIComponent;

// Templates
export const getTemplates = () => api.get<TemplatesResponse>('/templates');
export const getTemplate = (id: string) => api.get<Template>(`/templates/${enc(id)}`);
export const createTemplate = (body: CreateTemplateRequest) =>
  api.post<Template>('/templates', body);
export const updateTemplate = (id: string, body: UpdateTemplateRequest) =>
  api.patch<Template>(`/templates/${enc(id)}`, body);
export const deleteTemplate = (id: string) => api.delete<undefined>(`/templates/${enc(id)}`);
export const addTemplateItem = (id: string, body: AddItemRequest) =>
  api.post<TemplateItemMutationResponse>(`/templates/${enc(id)}/items`, body);
export const updateTemplateItem = (id: string, itemId: string, body: EditItemRequest) =>
  api.patch<TemplateItemMutationResponse>(`/templates/${enc(id)}/items/${enc(itemId)}`, body);
export const deleteTemplateItem = (id: string, itemId: string) =>
  api.delete<{ template: Template }>(`/templates/${enc(id)}/items/${enc(itemId)}`);

// Lists
export const getLists = () => api.get<ListsResponse>('/lists');
export const getList = (id: string, signal?: AbortSignal) =>
  api.get<ListDetail>(`/lists/${enc(id)}`, signal ? { signal } : {});
export const createList = (body: CreateListRequest = {}) =>
  api.post<CreateListResponse>('/lists', body);
export const updateList = (id: string, body: UpdateListRequest) =>
  api.patch<ListSummary>(`/lists/${enc(id)}`, body);
export const deleteList = (id: string) => api.delete<undefined>(`/lists/${enc(id)}`);
export const addTemplatesToList = (id: string, templateIds: string[]) =>
  api.post<AddTemplatesToListResponse>(`/lists/${enc(id)}/templates`, { templateIds });
export const addListItem = (id: string, body: AddItemRequest) =>
  api.post<ListItemMutationResponse>(`/lists/${enc(id)}/items`, body);
/** Default target (C1/C2): this week's list, created and flagged if there is none. */
export const addThisWeekItem = (body: AddItemRequest) =>
  api.post<ListItemMutationResponse>('/this-week/items', body);
export const updateListItem = (id: string, itemId: string, body: EditItemRequest) =>
  api.patch<ListItemUpdateResponse>(`/lists/${enc(id)}/items/${enc(itemId)}`, body);
export const deleteListItem = (id: string, itemId: string, version?: number) =>
  api.delete<ListItemDeleteResponse>(
    `/lists/${enc(id)}/items/${enc(itemId)}${version !== undefined ? `?version=${version}` : ''}`,
  );
export const finishList = (id: string) => api.post<ListArchiveResponse>(`/lists/${enc(id)}/finish`);
/** Undo an archive (within 2 minutes of completedAt). */
export const reopenList = (id: string) => api.post<ListArchiveResponse>(`/lists/${enc(id)}/reopen`);
export const getHistory = (cursor?: string, limit?: number) => {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const q = qs.toString();
  return api.get<HistoryResponse>(`/history${q ? `?${q}` : ''}`);
};

// Settings
export const getAisleOrder = () => api.get<AisleOrderResponse>('/settings/aisle-order');
export const saveAisleOrder = (order: string[], version?: number) =>
  api.put<AisleOrderResponse>('/settings/aisle-order', {
    order,
    ...(version !== undefined ? { version } : {}),
  });
export const resetAisleOrder = () => api.delete<AisleOrderResponse>('/settings/aisle-order');
export const getUnitOverrides = () => api.get<UnitOverridesResponse>('/settings/unit-overrides');
/** Remember a unit; the product's own default unit removes the override instead. */
export const saveUnitOverride = (productId: string, unit: UnitType) =>
  api.put<UnitOverrideResponse>(`/settings/unit-overrides/${enc(productId)}`, { unit });
export const deleteUnitOverride = (productId: string) =>
  api.delete<undefined>(`/settings/unit-overrides/${enc(productId)}`);
