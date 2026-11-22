import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './routes/AppLayout';
import { LoginPage } from './routes/LoginPage';
import { PlaceholderPage } from './routes/PlaceholderPage';
import { RequireAuth } from './routes/RequireAuth';

/**
 * Route map (docs/ux/app-shell.md). Screens are placeholders until built from docs/ux.
 * Public: /sign-in (+ /forgot-password, /new-password to be added). Everything else
 * requires a signed-in user.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<PlaceholderPage title="Lists" />} />
          <Route path="/search" element={<PlaceholderPage title="Search" />} />
          <Route path="/templates" element={<PlaceholderPage title="Templates" />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
