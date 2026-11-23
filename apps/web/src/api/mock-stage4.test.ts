import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, resetMockApi } from './mock';

const claims = { sub: 'user-1', email: 'sam@example.com', 'custom:householdId': 'home-1' };
const token = (c: Record<string, string>) =>
  `Bearer mock.${btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

async function call(path: string, init: RequestInit = {}, c: Record<string, string> = claims) {
  const promise = mockFetch(`/api${path}`, {
    ...init,
    headers: { authorization: token(c), 'content-type': 'application/json' },
  });
  await vi.runAllTimersAsync();
  const res = await promise;
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMockApi();
});

describe('mock Stage 4 API (consent and connected apps)', () => {
  it('describes known requests and 404s others', async () => {
    const r = await call('/oauth/requests/mock-claude');
    expect(r.body).toMatchObject({ clientName: 'Claude', redirectHost: 'claude.ai' });
    expect((await call('/oauth/requests/nope')).status).toBe(404);
  });

  it('Allow adds a connected app; Deny returns access_denied; Disconnect removes it', async () => {
    expect((await call('/connected-apps')).body.apps).toEqual([]);
    const deny = await call('/oauth/consent', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'mock-chatgpt', allow: false }),
    });
    expect(String(deny.body.redirectUrl)).toContain('error=access_denied');
    const allow = await call('/oauth/consent', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'mock-claude', allow: true }),
    });
    expect(String(allow.body.redirectUrl)).toMatch(/^https:\/\/claude\.ai\/.*code=/);
    const apps = (await call('/connected-apps')).body.apps as Array<Record<string, unknown>>;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ clientName: 'Claude', connectedBy: 'sam', lastUsedAt: null });
    // Another household sees nothing.
    const other = await call('/connected-apps', {}, { ...claims, 'custom:householdId': 'home-2' });
    expect(other.body.apps).toEqual([]);
    const del = await call(`/connected-apps/${String(apps[0]?.grantId)}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await call('/connected-apps')).body.apps).toEqual([]);
  });
});
