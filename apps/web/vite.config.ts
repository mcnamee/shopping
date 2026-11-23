/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && env.VITE_MOCK_AUTH === 'true') {
    throw new Error('VITE_MOCK_AUTH=true is for local dev/testing only and must not be built.');
  }

  return {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    test: {
      // Component tests opt in to jsdom with a `// @vitest-environment jsdom` pragma.
      setupFiles: ['./src/test/setup.ts'],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // External script (not inline) so the CSP can stay script-src 'self'.
        injectRegister: 'script-defer',
        includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Trolley',
          short_name: 'Trolley',
          description: 'Household shopping list for two',
          orientation: 'portrait',
          lang: 'en-AU',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          theme_color: '#1B36FF',
          background_color: '#1B36FF',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          // Never let the service worker answer API, runtime-config, OAuth or MCP requests (Claude's
          // connector sign-in opens /oauth/authorize, which must reach the server).
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/config\.json$/,
            /^\/oauth\//,
            /^\/\.well-known\//,
            /^\/mcp/,
          ],
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        },
      }),
    ],
    server: {
      port: 5173,
      ...(env.VITE_API_PROXY
        ? {
            proxy: {
              '/api': { target: env.VITE_API_PROXY, changeOrigin: true, secure: true },
            },
          }
        : {}),
    },
  };
});
