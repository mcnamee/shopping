import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AuthError, useAuth } from '../auth';

/**
 * Minimal, unstyled sign-in so Stage 0 plumbing can be exercised.
 * The software engineer replaces this with the docs/ux design (incl. forgot password).
 */
export function LoginPage() {
  const { status, signIn, completeNewPassword } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof AuthError ? err.code : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }

  const onSignIn = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signIn(email, password));
  };
  const onNewPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(() => completeNewPassword(newPassword));
  };

  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Trolley</h1>
      {status === 'newPasswordRequired' ? (
        <form onSubmit={onNewPassword} className="space-y-3">
          <label className="block">
            New password
            <input
              className="block w-full rounded border p-2"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button className="min-h-11 rounded border px-4" disabled={busy} type="submit">
            Set password
          </button>
        </form>
      ) : (
        <form onSubmit={onSignIn} className="space-y-3">
          <label className="block">
            Email
            <input
              className="block w-full rounded border p-2"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            Password
            <input
              className="block w-full rounded border p-2"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="min-h-11 rounded border px-4" disabled={busy} type="submit">
            Sign in
          </button>
        </form>
      )}
      {error && (
        <p role="alert" data-testid="auth-error">
          {error}
        </p>
      )}
    </main>
  );
}
