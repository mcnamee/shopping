import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && env.VITE_MOCK_AUTH === 'true') {
    throw new Error('VITE_MOCK_AUTH=true is for local dev/testing only and must not be built.');
  }

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // External script (not inline) so the CSP can stay script-src 'self'.
        injectRegister: 'script-defer',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Trolley',
          short_name: 'Trolley',
          description: 'Our household shopping list',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          // docs/ux/app-shell.md (PWA). Final PNG/maskable icons to be added per UX spec.
          theme_color: '#0B6B63',
          background_color: '#ffffff',
          icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        },
        workbox: {
          navigateFallback: '/index.html',
          // Never let the service worker answer API or runtime-config requests.
          navigateFallbackDenylist: [/^\/api\//, /^\/config\.json$/],
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
