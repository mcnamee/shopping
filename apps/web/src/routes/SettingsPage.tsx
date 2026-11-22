import { Loader2, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';

/** /settings (docs/ux/app-shell.md section 3): account card + sign out with confirmation. */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    // Local sign-out always succeeds (AuthProvider clears the session even if the
    // network call fails); RequireAuth then routes to /sign-in.
    await signOut();
  }

  return (
    <div>
      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Account</h2>
      <div className="rounded-md bg-surface p-4">
        <p className="text-sm text-muted">Signed in as</p>
        <p className="select-text break-all text-lg">{user?.email}</p>
      </div>

      <Button variant="danger-outline" className="mt-4" onClick={() => setConfirming(true)}>
        <LogOut aria-hidden className="h-5 w-5" />
        Sign out
      </Button>

      <p className="mt-6 text-sm text-muted">Trolley v{__APP_VERSION__}</p>

      {confirming && (
        <ConfirmSheet
          title="Sign out of Trolley?"
          description="You'll need your email and password to sign back in."
          busy={busy}
          confirm={
            busy ? (
              <>
                <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                Signing out...
              </>
            ) : (
              'Sign out'
            )
          }
          cancel="Cancel"
          onConfirm={() => void onConfirm()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
