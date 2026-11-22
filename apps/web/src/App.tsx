import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ToastProvider } from './components/Toast';
import { AppLayout } from './routes/AppLayout';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage';
import { NewPasswordPage } from './routes/NewPasswordPage';
import { PlaceholderPage } from './routes/PlaceholderPage';
import { PublicOnly, RequireAuth } from './routes/RequireAuth';
import { SearchPage } from './routes/SearchPage';
import { SettingsPage } from './routes/SettingsPage';
import { SignInPage } from './routes/SignInPage';

/** Route map (docs/ux/app-shell.md section 7). */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <PublicOnly>
            <SignInPage />
          </PublicOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnly>
            <ForgotPasswordPage />
          </PublicOnly>
        }
      />
      <Route
        path="/new-password"
        element={
          <PublicOnly>
            <NewPasswordPage />
          </PublicOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<PlaceholderPage kind="lists" />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/templates" element={<PlaceholderPage kind="templates" />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  );
}
