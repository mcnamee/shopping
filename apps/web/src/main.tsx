import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider, initAuth } from './auth';
import { loadConfig } from './config';
import { MOCK_AUTH } from './env';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');
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
    root.render(
      <main role="alert" className="p-6">
        <h1 className="text-lg font-semibold">Trolley couldn&apos;t start</h1>
        <p>Please check your connection and try again.</p>
      </main>,
    );
  }
}

void start();
