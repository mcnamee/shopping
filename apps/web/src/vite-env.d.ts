/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_AUTH?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_USER_POOL_ID?: string;
  readonly VITE_USER_POOL_CLIENT_ID?: string;
  readonly VITE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected from package.json by vite.config.ts. */
declare const __APP_VERSION__: string;
