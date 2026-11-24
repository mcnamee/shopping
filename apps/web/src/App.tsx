import { Navigate, Route, RouterProvider, Routes, createBrowserRouter } from 'react-router';
import { HistoryPage } from './lists/HistoryPage';
import { ListPage } from './lists/ListPage';
import { ListsPage } from './lists/ListsPage';
import { ToastProvider } from './components/Toast';
import { AisleOrderPage } from './settings/AisleOrderPage';
import { UnitsPage } from './settings/UnitsPage';
import { RecipeDetailPage } from './recipes/RecipeDetailPage';
import { RecipeEditorPage } from './recipes/RecipeEditorPage';
import { RecipesPage } from './recipes/RecipesPage';
import { TemplateEditorPage } from './templates/TemplateEditorPage';
import { TemplatesPage } from './templates/TemplatesPage';
import { AppLayout } from './routes/AppLayout';
import { ConnectPage } from './routes/ConnectPage';
import { ConnectedAppsPage } from './settings/ConnectedAppsPage';
import { ShortcutsPage } from './settings/ShortcutsPage';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage';
import { NewPasswordPage } from './routes/NewPasswordPage';
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
      <Route path="/connect" element={<ConnectPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<ListsPage />} />
        <Route path="/lists/history" element={<HistoryPage />} />
        <Route path="/lists/:id" element={<ListPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/recipes/new" element={<RecipeEditorPage isNew />} />
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
        <Route path="/recipes/:id/edit" element={<RecipeEditorPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/new" element={<TemplateEditorPage isNew />} />
        <Route path="/templates/:id" element={<TemplateEditorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/aisle-order" element={<AisleOrderPage />} />
        <Route path="/settings/units" element={<UnitsPage />} />
        <Route path="/settings/connected-apps" element={<ConnectedAppsPage />} />
        <Route path="/settings/shortcuts" element={<ShortcutsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// A data router (not <BrowserRouter>) so screens can use useBlocker for unsaved-change guards.
const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }]);

export function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
}
