import { useQueryClient } from '@tanstack/react-query';
import type { ShortcutKey, ShortcutKeysResponse } from '@trolley/core';
import { Loader2, Mic } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createShortcutKey, revokeShortcutKey } from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { ErrorView, Skeleton } from '../components/StateViews';
import { TextField } from '../components/TextField';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { connectedDate, lastUsedLabel } from './connectedAppsFormat';
import { shortcutKeysKey, useShortcutKeysQuery } from './hooks';

const KEY_PLACEHOLDER = '<your key>';

function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.show('Copied');
    } catch {
      toast.show("Couldn't copy - select the text and copy it");
    }
  }
  return (
    <div className="mt-2 rounded-md bg-bg p-3">
      <p className="text-sm font-semibold">{label}</p>
      <p className="select-all break-all font-mono text-base" data-testid={testId}>
        {value}
      </p>
      <Button variant="secondary" className="mt-2" onClick={() => void copy()}>
        Copy {label.toLowerCase()}
      </Button>
    </div>
  );
}

/** Shared iCloud link to the ready-made shortcut; it asks for the key on import. */
const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/048b8a16be834d65b41a394ad1221ec4';

function Instructions({ origin, keyValue }: { origin: string; keyValue: string | null }) {
  const header = `Bearer ${keyValue ?? KEY_PLACEHOLDER}`;
  return (
    <section aria-labelledby="shortcut-steps" className="mt-8">
      <h2 id="shortcut-steps" className="text-lg font-semibold">
        Get the shortcut
      </h2>
      <p className="mt-1 text-base text-muted">
        On your iPhone, open the link below and tap <b>Add Shortcut</b>. When it asks for the secret
        key, paste your key (it starts with <b>trl_</b>).
        {keyValue === null && ' Create a key above first.'}
      </p>
      <a
        href={SHORTCUT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-4 text-base font-semibold text-accent-on"
      >
        Get &ldquo;Add to Trolley&rdquo;
      </a>
      <p className="mt-3 text-base text-muted">
        Then say &ldquo;Hey Siri, Add to Trolley&rdquo; and answer when it asks.
      </p>
      <details className="mt-6 rounded-md border border-border-subtle px-4 py-3">
        <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
          Or build it yourself
        </summary>
        <ol className="mt-3 list-decimal space-y-4 pl-5 text-base">
          <li>
            Tap <b>+</b> to make a new shortcut and name it <b>Add to Trolley</b>. That name is what
            you say to Siri.
          </li>
          <li>
            Add <b>Ask for Text</b> with the prompt <b>What should I add?</b>
          </li>
          <li>
            Add <b>Get Contents of URL</b>. Set the URL, then tap Show More and set Method to{' '}
            <b>POST</b>.
            <CopyRow label="Address" value={`${origin}/api/quick/add`} testId="quick-add-url" />
            <p className="mt-2">
              Add a header named <b>Authorization</b> with this value:
            </p>
            <CopyRow label="Header value" value={header} testId="quick-auth-header" />
            <p className="mt-2">
              Set Request Body to <b>JSON</b>, add a Text field named <b>text</b> and choose{' '}
              <b>Provided Input</b> (the answer from Ask for Text).
            </p>
          </li>
          <li>
            Add <b>Get Dictionary Value</b>: get the value for <b>spoken</b> from Contents of URL.
          </li>
          <li>
            Add <b>Speak Text</b> (or Show Result) and give it the Dictionary Value.
          </li>
        </ol>
        <p className="mt-3 text-base text-muted">
          Then say &ldquo;Hey Siri, Add to Trolley&rdquo; and answer when it asks.
        </p>
        <h3 className="mt-6 text-base font-semibold">Optional: What&rsquo;s on my Trolley list</h3>
        <p className="mt-1 text-base text-muted">
          Make a second shortcut with that name: <b>Get Contents of URL</b> with the address below,
          Method <b>GET</b> and the same Authorization header, then Get Dictionary Value{' '}
          <b>spoken</b> and Speak Text.
        </p>
        <CopyRow label="List address" value={`${origin}/api/quick/list`} testId="quick-list-url" />
      </details>
    </section>
  );
}

/** Settings > Siri & Shortcuts: personal access keys and how to build the shortcut. */
export function ShortcutsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const query = useShortcutKeysQuery();
  const showSkeleton = useDelayedFlag(query.isPending, 150);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The raw key, held in memory only until the person is done with it. */
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [target, setTarget] = useState<ShortcutKey | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = window.location.origin;

  const keys = query.data?.keys ?? [];
  const max = query.data?.max ?? 5;
  const full = keys.length >= max;

  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show('Copied');
    } catch {
      toast.show("Couldn't copy - select the key and copy it");
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give the key a name, like "Matt\'s iPhone"');
      return;
    }
    if (!online) {
      toast.show("You're offline. Reconnect to create a key.");
      return;
    }
    setCreating(true);
    setNameError(null);
    try {
      const res = await createShortcutKey(trimmed);
      setNewKey({ key: res.key, name: res.shortcutKey.name });
      setName('');
    } catch {
      toast.show("Couldn't create the key - try again");
    } finally {
      setCreating(false);
      void qc.invalidateQueries({ queryKey: shortcutKeysKey });
    }
  }

  async function revoke(k: ShortcutKey) {
    if (!online) {
      setTarget(null);
      toast.show("You're offline. Reconnect to change this.");
      return;
    }
    setBusy(true);
    try {
      await revokeShortcutKey(k.keyId);
      qc.setQueryData<ShortcutKeysResponse>(shortcutKeysKey, (old) =>
        old ? { ...old, keys: old.keys.filter((x) => x.keyId !== k.keyId) } : old,
      );
      toast.show(`${k.name} revoked`);
    } catch {
      toast.show("Couldn't revoke - try again");
    } finally {
      setBusy(false);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: shortcutKeysKey });
    }
  }

  let list: React.ReactNode;
  if (query.isPending) {
    list = showSkeleton ? (
      <div aria-busy="true">
        <p className="sr-only">Loading keys</p>
        <Skeleton className="h-[72px] rounded-md" />
      </div>
    ) : null;
  } else if (query.isError && !query.data) {
    list = (
      <ErrorView
        title="Couldn't load your keys"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (keys.length === 0) {
    list = <p className="text-base text-muted">No keys yet.</p>;
  } else {
    list = (
      <ul aria-label="Keys" className="space-y-3">
        {keys.map((k) => (
          <li key={k.keyId} className="rounded-md bg-surface p-4">
            <p className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{k.name}</p>
            <p className="text-sm text-muted">
              Created {connectedDate(k.createdAt)} by {k.createdBy} - {lastUsedLabel(k.lastUsedAt)}
            </p>
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                aria-label={`Revoke ${k.name}`}
                onClick={() => setTarget(k)}
                className="min-h-tap rounded-sm px-3 text-base font-semibold text-danger active:bg-danger-soft"
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <PageHeader title="Siri & Shortcuts" backTo="/settings" backLabel="Back to settings" />
      <main className="px-[max(16px,var(--safe-left))] pb-8 pt-4">
        <div className="flex items-start gap-3">
          <Mic aria-hidden className="mt-1 h-6 w-6 shrink-0" />
          <p className="text-base text-muted">
            Say &ldquo;Hey Siri, Add to Trolley&rdquo; to add things to this week&rsquo;s list
            without opening the app. A key lets the Shortcuts app add items and read your list,
            nothing else.
          </p>
        </div>

        {newKey ? (
          <section
            aria-label="Your new key"
            className="mt-6 rounded-md border-2 border-accent bg-surface p-4"
          >
            <p className="text-base font-semibold">Key for {newKey.name}</p>
            <p className="mt-1 text-base">
              Copy it now. For your safety it won&rsquo;t be shown again. If you lose it, revoke it
              and create a new one.
            </p>
            <p
              className="mt-2 select-all break-all rounded-md bg-bg p-3 font-mono text-base"
              data-testid="new-key"
            >
              {newKey.key}
            </p>
            <div className="mt-3 flex gap-3">
              <Button variant="primary" onClick={() => void copyKey(newKey.key)}>
                Copy key
              </Button>
              <Button variant="secondary" onClick={() => setNewKey(null)}>
                Done
              </Button>
            </div>
          </section>
        ) : (
          <form onSubmit={(e) => void create(e)} className="mt-6" noValidate>
            <TextField
              label="Key name"
              placeholder="Matt's iPhone"
              value={name}
              maxLength={40}
              error={nameError}
              disabled={full}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              autoComplete="off"
            />
            <Button type="submit" variant="primary" className="mt-3" disabled={creating || full}>
              {creating ? (
                <>
                  <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create key'
              )}
            </Button>
            {full && (
              <p className="mt-2 text-sm text-muted">
                You have {max} keys, the most allowed. Revoke one to make another.
              </p>
            )}
          </form>
        )}

        <h2 className="mb-2 mt-8 text-lg font-semibold">Your keys</h2>
        {list}

        <Instructions origin={origin} keyValue={newKey?.key ?? null} />
      </main>
      {target && (
        <ConfirmSheet
          title={`Revoke ${target.name}?`}
          description="The shortcut using this key will stop working. You can make a new key any time."
          busy={busy}
          confirm={
            busy ? (
              <>
                <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                Revoking...
              </>
            ) : (
              'Revoke'
            )
          }
          cancel="Cancel"
          onConfirm={() => void revoke(target)}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
