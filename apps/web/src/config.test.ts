import { describe, expect, it, vi } from 'vitest';
import { ConfigError, MOCK_CONFIG, loadConfig, parseConfig } from './config';

const valid = { region: 'ap-southeast-2', userPoolId: 'pool', userPoolClientId: 'client' };

describe('parseConfig', () => {
  it('accepts a valid config', () => {
    expect(parseConfig(valid)).toEqual(valid);
  });
  it('rejects missing fields', () => {
    expect(() => parseConfig({ ...valid, userPoolId: '' })).toThrow(ConfigError);
    expect(() => parseConfig(null)).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('returns the mock config in mock mode without fetching', async () => {
    const fetchImpl = vi.fn();
    await expect(loadConfig({ mock: true, dev: true, env: {}, fetchImpl })).resolves.toBe(
      MOCK_CONFIG,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses VITE_ env values in dev when present', async () => {
    const config = await loadConfig({
      mock: false,
      dev: true,
      env: { VITE_USER_POOL_ID: 'p', VITE_USER_POOL_CLIENT_ID: 'c' },
    });
    expect(config).toEqual({ region: 'ap-southeast-2', userPoolId: 'p', userPoolClientId: 'c' });
  });

  it('fetches /config.json in production', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(valid)));
    const config = await loadConfig({
      mock: false,
      dev: false,
      env: { VITE_USER_POOL_ID: 'ignored', VITE_USER_POOL_CLIENT_ID: 'ignored' },
      fetchImpl,
    });
    expect(config).toEqual(valid);
    expect(fetchImpl).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
  });

  it('throws a ConfigError when config.json is unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(loadConfig({ mock: false, dev: false, env: {}, fetchImpl })).rejects.toThrow(
      ConfigError,
    );
  });
});
