/**
 * Scraper settings from environment variables (Lambda env, or the shell for the CLI).
 *   ALDI_SERVICE_POINT     ALDI store id; default G526 (Casey ACT). "none" = no store.
 *   SCRAPE_MIN_INTERVAL_MS gap between ALDI requests (min 500, default 1000)
 *   SCRAPE_MAX_REQUESTS    hard request budget per run (default 400)
 *   SCRAPE_MAX_PRODUCTS    unique product cap per run (default 10000)
 */
import { DEFAULT_SERVICE_POINT } from './aldi-client';

export interface ScraperConfig {
  servicePoint: string | null;
  minIntervalMs: number;
  maxRequests: number;
  maxProducts: number;
}

function intEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function servicePointFrom(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return DEFAULT_SERVICE_POINT;
  if (v.toLowerCase() === 'none') return null;
  if (!/^[A-Z0-9-]{2,12}$/.test(v))
    throw new Error('ALDI_SERVICE_POINT must look like "G526" or be "none"');
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScraperConfig {
  return {
    servicePoint: servicePointFrom(env.ALDI_SERVICE_POINT),
    // Never faster than 2 requests/second, whatever the config says.
    minIntervalMs: intEnv(env, 'SCRAPE_MIN_INTERVAL_MS', 1000, 500, 60_000),
    maxRequests: intEnv(env, 'SCRAPE_MAX_REQUESTS', 400, 1, 5000),
    maxProducts: intEnv(env, 'SCRAPE_MAX_PRODUCTS', 10_000, 1, 50_000),
  };
}
