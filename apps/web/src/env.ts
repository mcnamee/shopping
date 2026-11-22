/** True when running with VITE_MOCK_AUTH=true (local dev / Playwright only; never built). */
export const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true';
