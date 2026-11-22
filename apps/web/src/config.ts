/**
 * Runtime configuration.
 *
 * Production: CDK writes /config.json next to index.html at deploy time, so the same
 * build works for any stack. Dev: VITE_* variables are used if set, else /config.json
 * (e.g. via VITE_API_PROXY you can still fetch a deployed config manually).
 */
export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function requireString(source: Record<string, unknown>, key: keyof AppConfig): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`config.json is missing "${key}"`);
  }
  return value.trim();
}

export function parseConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null)
    throw new ConfigError('config.json is not an object');
  const source = raw as Record<string, unknown>;
  return {
    region: requireString(source, 'region'),
    userPoolId: requireString(source, 'userPoolId'),
    userPoolClientId: requireString(source, 'userPoolClientId'),
  };
}

export interface LoadConfigOptions {
  mock: boolean;
  dev: boolean;
  env: Partial<
    Record<'VITE_AWS_REGION' | 'VITE_USER_POOL_ID' | 'VITE_USER_POOL_CLIENT_ID', string>
  >;
  fetchImpl?: typeof fetch;
}

export const MOCK_CONFIG: AppConfig = {
  region: 'ap-southeast-2',
  userPoolId: 'ap-southeast-2_mock',
  userPoolClientId: 'mock-client',
};

export async function loadConfig(options: LoadConfigOptions): Promise<AppConfig> {
  if (options.mock) return MOCK_CONFIG;

  const { VITE_AWS_REGION, VITE_USER_POOL_ID, VITE_USER_POOL_CLIENT_ID } = options.env;
  if (options.dev && VITE_USER_POOL_ID && VITE_USER_POOL_CLIENT_ID) {
    return parseConfig({
      region: VITE_AWS_REGION || 'ap-southeast-2',
      userPoolId: VITE_USER_POOL_ID,
      userPoolClientId: VITE_USER_POOL_CLIENT_ID,
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new ConfigError(`Could not load /config.json (HTTP ${res.status})`);
  return parseConfig(await res.json());
}
