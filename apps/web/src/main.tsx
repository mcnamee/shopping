import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider, initAuth } from './auth';
import { loadConfig } from './config';
import { MOCK_AUTH } from './env';
import { CACHE_GC_MS, startCachePersistence } from './offline/cachePersist';
import { ConfigErrorScreen } from './routes/ConfigErrorScreen';
import { applyTextSize, readTextSize } from './settings/textSize';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: CACHE_GC_MS, staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

// Mirror the lists/list queries to localStorage for offline shop mode (B-006).
startCachePersistence(queryClient);

// Apply the saved text size before the first render (CSP forbids an inline script).
applyTextSize(readTextSize());

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');
// Feel like an app: block iOS pinch-zoom (Safari ignores user-scalable=no for pinch).
for (const type of ['gesturestart', 'gesturechange'] as const) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const root = createRoot(container);

async function start() {
  try {
    const config = await loadConfig({
      mock: MOCK_AUTH,
      dev: import.meta.env.DEV,
      env: import.meta.env,
    });
    const auth = initAuth(config);
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <AuthProvider auth={auth}>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    root.render(<ConfigErrorScreen />);
  }
}

void start();
