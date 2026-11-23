import { ArrowUpDown, ChevronRight, Loader2, LogOut, Plug, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { saveTextSize, readTextSize, TEXT_SIZES, type TextSize } from '../settings/textSize';
import { useConnectedAppsQuery } from '../settings/hooks';
import { useAisleOrderQuery, useUnitOverridesQuery } from '../lists/data';

/** /settings (docs/ux/app-shell.md section 3): account card + sign out with confirmation. */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const aisle = useAisleOrderQuery();
  const units = useUnitOverridesQuery();
  const apps = useConnectedAppsQuery();
  const appCount = apps.data?.apps.length;
  const appsValue =
    appCount === undefined
      ? null
      : appCount === 0
        ? 'None'
        : `${appCount} ${appCount === 1 ? 'app' : 'apps'}`;
  const unitCount = units.data?.overrides.length;
  const aisleValue = aisle.data ? (aisle.data.isDefault ? 'ALDI order' : 'Custom order') : null;
  const unitsValue =
    unitCount === undefined
      ? null
      : unitCount === 0
        ? 'None yet'
        : `${unitCount} ${unitCount === 1 ? 'product' : 'products'}`;

  async function onConfirm() {
    setBusy(true);
    // Local sign-out always succeeds (AuthProvider clears the session even if the
    // network call fails); RequireAuth then routes to /sign-in.
    await signOut();
  }

  return (
    <div>
      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Shopping</h2>
      <ul className="mb-6 overflow-hidden rounded-md bg-surface">
        {[
          {
            to: '/settings/aisle-order',
            Icon: ArrowUpDown,
            label: 'Aisle order',
            value: aisleValue,
          },
          { to: '/settings/units', Icon: Tag, label: 'Remembered units', value: unitsValue },
        ].map(({ to, Icon, label, value }) => (
          <li key={to} className="border-b border-border-subtle last:border-b-0">
            <Link to={to} className="flex min-h-16 items-center gap-3 px-4 active:bg-accent-soft">
              <Icon aria-hidden className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg">{label}</span>
                {value && <span className="block text-sm font-normal text-muted">{value}</span>}
              </span>
              <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Connected apps</h2>
      <ul className="mb-6 overflow-hidden rounded-md bg-surface">
        <li>
          <Link
            to="/settings/connected-apps"
            className="flex min-h-16 items-center gap-3 px-4 active:bg-accent-soft"
          >
            <Plug aria-hidden className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-lg">Connected apps</span>
              {appsValue && (
                <span className="block text-sm font-normal text-muted">{appsValue}</span>
              )}
            </span>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
          </Link>
        </li>
      </ul>

      <h2 id="display-heading" className="mb-2 text-xs uppercase tracking-wide text-muted">
        Display
      </h2>
      <div className="mb-6 rounded-md bg-surface p-4">
        <p id="text-size-label" className="mb-2 text-lg">
          Text size
        </p>
        <div role="radiogroup" aria-labelledby="text-size-label" className="grid grid-cols-3 gap-2">
          {TEXT_SIZES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={textSize === value}
              onClick={() => {
                setTextSize(value);
                saveTextSize(value);
              }}
              className={`min-h-tap rounded-sm border-2 px-2 text-base ${
                textSize === value
                  ? 'border-accent bg-accent-soft text-accent-strong'
                  : 'border-border-subtle bg-bg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
