/**
 * Fetch wrapper for the Trolley API. All paths are relative to '/api' (same origin via
 * CloudFront in production; Vite proxy or mock in dev). Adds the Cognito ID token as a
 * Bearer token. Household scoping happens server-side from the token - never send a
 * householdId in requests.
 */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    public readonly status: number,
    /** Stable error code from the API body (e.g. 'NO_HOUSEHOLD'), or null. */
    public readonly code: string | null,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

let unauthorisedHandler: (() => void) | null = null;

/** Registered by AuthProvider: called when the API returns 401. */
export function setUnauthorisedHandler(handler: (() => void) | null): void {
  unauthorisedHandler = handler;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '/api';

  async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/')) throw new Error(`API path must start with '/': ${path}`);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await options.getIdToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      if (res.status === 401) unauthorisedHandler?.();
      const obj =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const code = typeof obj.code === 'string' ? obj.code : null;
      const message = typeof obj.message === 'string' ? obj.message : `HTTP ${res.status}`;
      throw new ApiError(res.status, code, message, parsed);
    }
    return parsed as T;
  }

  return {
    request,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
