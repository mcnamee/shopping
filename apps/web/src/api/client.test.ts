import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, setUnauthorisedHandler } from './client';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

afterEach(() => setUnauthorisedHandler(null));

describe('createApiClient', () => {
  it('prefixes /api and sends the ID token as a Bearer token', async () => {
    const fetchImpl = fakeFetch(200, { status: 'ok' });
    const api = createApiClient({ getIdToken: async () => 'id-token', fetchImpl });
    await expect(api.get('/health')).resolves.toEqual({ status: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/health');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer id-token');
  });

  it('omits Authorization when signed out', async () => {
    const fetchImpl = fakeFetch(200, {});
    const api = createApiClient({ getIdToken: async () => null, fetchImpl });
    await api.get('/health');
    expect((fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe(
      undefined,
    );
  });

  it('serialises JSON bodies', async () => {
    const fetchImpl = fakeFetch(201, { id: '1' });
    const api = createApiClient({ getIdToken: async () => 't', fetchImpl });
    await api.post('/things', { name: 'milk' });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"milk"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('throws ApiError with status and message', async () => {
    const api = createApiClient({
      getIdToken: async () => 't',
      fetchImpl: fakeFetch(403, { code: 'NO_HOUSEHOLD', message: 'No household' }),
    });
    await expect(api.get('/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'NO_HOUSEHOLD',
      message: 'No household',
    });
  });

  it('calls the unauthorised handler on 401', async () => {
    const onUnauthorised = vi.fn();
    setUnauthorisedHandler(onUnauthorised);
    const api = createApiClient({
      getIdToken: async () => 't',
      fetchImpl: fakeFetch(401, { message: 'Unauthorized' }),
    });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorised).toHaveBeenCalledOnce();
  });

  it('handles empty responses', async () => {
    const api = createApiClient({
      getIdToken: async () => 't',
      fetchImpl: fakeFetch(204, undefined),
    });
    await expect(api.delete('/things/1')).resolves.toBeUndefined();
  });
});
