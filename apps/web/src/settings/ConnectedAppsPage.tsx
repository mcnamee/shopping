import { useQueryClient } from '@tanstack/react-query';
import type { ConnectedApp, ConnectedAppsResponse } from '@trolley/core';
import { Loader2, Plug } from 'lucide-react';
import { useState } from 'react';
import { disconnectApp } from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { connectedDate, lastUsedLabel } from './connectedAppsFormat';
import { connectedAppsKey, useConnectedAppsQuery } from './hooks';

function CopyAddress({ url }: { url: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Copied');
    } catch {
      toast.show("Couldn't copy - select the address and copy it");
    }
  }
  return (
    <div className="w-full rounded-md bg-surface p-4 text-left">
      <p className="select-all break-all font-mono text-base" data-testid="mcp-url">
        {url}
      </p>
      <Button variant="secondary" className="mt-3" onClick={() => void copy()}>
        Copy
      </Button>
    </div>
  );
}

function Steps() {
  return (
    <div className="mt-6 w-full text-left">
      <h3 className="text-base font-semibold">How to connect</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-base text-muted">
        <li>
          In Claude, open Settings, then Connectors, then Add custom connector. In ChatGPT, turn on
          developer mode and add an app.
        </li>
        <li>Paste the address above and choose OAuth if asked.</li>
        <li>Sign in to Trolley when prompted, then tap Allow.</li>
        <li>Ask it to "add tissues to my shopping list".</li>
      </ol>
    </div>
  );
}

/** Settings > Connected apps (stage 4, E2). */
export function ConnectedAppsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const query = useConnectedAppsQuery();
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const [target, setTarget] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);

  async function disconnect(app: ConnectedApp) {
    if (!online) {
      setTarget(null);
      toast.show("You're offline. Reconnect to change this.");
      return;
    }
    setBusy(true);
    try {
      await disconnectApp(app.grantId);
      qc.setQueryData<ConnectedAppsResponse>(connectedAppsKey, (old) =>
        old ? { ...old, apps: old.apps.filter((a) => a.grantId !== app.grantId) } : old,
      );
      toast.show(`${app.clientName} disconnected`);
    } catch {
      toast.show("Couldn't disconnect - try again");
    } finally {
      setBusy(false);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: connectedAppsKey });
    }
  }

  let body: React.ReactNode;
  if (query.isPending) {
    body = showSkeleton ? (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only">Loading connected apps</p>
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-md" />
        ))}
      </div>
    ) : null;
  } else if (query.isError && !query.data) {
    body = (
      <ErrorView
        title="Couldn't load connected apps"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data && query.data.apps.length === 0) {
    body = (
      <EmptyView
        Icon={Plug}
        title="No apps connected"
        body="Add Trolley as a connector in Claude or ChatGPT with this address:"
      >
        <CopyAddress url={query.data.mcpUrl} />
        <Steps />
      </EmptyView>
    );
  } else if (query.data) {
    body = (
      <ul aria-label="Connected apps" className="space-y-3">
        {query.data.apps.map((app) => (
          <li key={app.grantId} className="rounded-md bg-surface p-4">
            <p className="break-words text-lg font-semibold [overflow-wrap:anywhere]">
              {app.clientName}
            </p>
            <p className="text-sm text-muted">
              Connected {connectedDate(app.connectedAt)} by {app.connectedBy} -{' '}
              {lastUsedLabel(app.lastUsedAt)}
            </p>
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                aria-label={`Disconnect ${app.clientName}`}
                onClick={() => setTarget(app)}
                className="min-h-tap rounded-sm px-3 text-base font-semibold text-danger active:bg-danger-soft"
              >
                Disconnect
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <PageHeader title="Connected apps" backTo="/settings" backLabel="Back to settings" />
      <main className="px-[max(16px,var(--safe-left))] pb-8 pt-4">{body}</main>
      {target && (
        <ConfirmSheet
          title={`Disconnect ${target.clientName}?`}
          description={`It will no longer see or change your lists. You can reconnect from ${target.clientName} any time.`}
          busy={busy}
          confirm={
            busy ? (
              <>
                <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                Disconnecting...
              </>
            ) : (
              'Disconnect'
            )
          }
          cancel="Cancel"
          onConfirm={() => void disconnect(target)}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
