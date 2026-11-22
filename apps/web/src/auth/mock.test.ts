import { describe, expect, it } from 'vitest';
import { mockFetch } from '../api/mock';
import { createMockAuth, encodeMockToken, MOCK_PASSWORD, MOCK_TEMP_PASSWORD } from './mock';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const make = () => createMockAuth({ storage: memoryStorage(), latencyMs: 0 });

describe('mock auth', () => {
  it('signs in and out', async () => {
    const auth = make();
    await expect(auth.signIn('Me@Example.com', MOCK_PASSWORD)).resolves.toEqual({
      status: 'SIGNED_IN',
    });
    expect(await auth.getCurrentUser()).toMatchObject({
      email: 'me@example.com',
      householdId: 'mock-household',
    });
    expect(await auth.getIdToken()).toMatch(/^mock\./);
    await auth.signOut();
    expect(await auth.getCurrentUser()).toBeNull();
    expect(await auth.getIdToken()).toBeNull();
  });

  it('rejects a wrong password', async () => {
    await expect(make().signIn('me@example.com', 'nope')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('requires a new password for the invited user', async () => {
    const auth = make();
    await expect(auth.signIn('new@example.com', MOCK_TEMP_PASSWORD)).resolves.toEqual({
      status: 'NEW_PASSWORD_REQUIRED',
    });
    await expect(auth.completeNewPassword('weak')).rejects.toMatchObject({
      code: 'PASSWORD_POLICY',
    });
    await expect(auth.completeNewPassword('Str0ngPass')).resolves.toEqual({ status: 'SIGNED_IN' });
    expect((await auth.getCurrentUser())?.email).toBe('new@example.com');
  });

  it('supports password reset with the fixed code', async () => {
    const auth = make();
    await expect(auth.resetPassword('me@example.com')).resolves.toHaveProperty('destination');
    await expect(
      auth.confirmResetPassword('me@example.com', '000000', 'Str0ngPass'),
    ).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    await expect(
      auth.confirmResetPassword('me@example.com', '123456', 'Str0ngPass'),
    ).resolves.toBeUndefined();
  });
});

describe('mock API', () => {
  it('serves /api/me from the mock token and enforces auth', async () => {
    const token = encodeMockToken({ userId: 'u1', email: 'a@b.c', householdId: 'hh' });
    const ok = await mockFetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(await ok.json()).toEqual({ userId: 'u1', email: 'a@b.c', householdId: 'hh' });

    expect((await mockFetch('/api/me')).status).toBe(401);

    const noHh = encodeMockToken({ userId: 'u2', email: 'x@y.z', householdId: null });
    const forbidden = await mockFetch('/api/me', { headers: { authorization: `Bearer ${noHh}` } });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: 'NO_HOUSEHOLD' });
  });
});
