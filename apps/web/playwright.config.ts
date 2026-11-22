import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against `vite dev` in mock-auth mode (no AWS). iPhone 13 profile (390x844, WebKit UA
 * is overridden to Chromium via the preinstalled browser; viewport/touch/DPR are kept).
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium whose build differs from the
 * installed @playwright/test version (never run `playwright install` in the sandbox).
 */
const PORT = 5199;
const REAL_PORT = 5198; // non-mock dev server: exercises the real /config.json loading path
const executablePath = process.env['PW_CHROMIUM_PATH'];
const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];

export const REAL_BASE_URL = `http://localhost:${REAL_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    ...iphone,
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'iphone-13', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `npm run dev:mock -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/sign-in`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${REAL_PORT} --strictPort`,
      url: `http://localhost:${REAL_PORT}/`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
