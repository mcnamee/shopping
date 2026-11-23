import { useQuery } from '@tanstack/react-query';
import { Link2Off } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ApiError, getOAuthRequest, sendOAuthConsent } from '../api';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/Button';
import { Skeleton } from '../components/StateViews';
import { Splash } from '../components/Splash';
import { useToast } from '../components/Toast';
import { TrolleyGlyph } from '../components/TrolleyGlyph';
import { goExternal } from '../lib/navigate';
import { clearPendingConnect, rememberConnectPath, type AuthRouteState } from './routeState';

const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

function Brand() {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <TrolleyGlyph size={48} />
      <p className="mt-2 text-2xl font-semibold">Trolley</p>
    </div>
  );
}

function InvalidLink() {
  return (
    <AuthLayout>
      <Brand />
      <div role="alert" className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Link2Off aria-hidden size={40} />
        </div>
        <h1 className="mt-4 text-xl">This connection link isn't valid or has expired</h1>
        <p className="mt-2 text-base text-muted">Start again from the app you're connecting.</p>
      </div>
      <Link
        to="/"
        className="mt-6 flex min-h-primary w-full items-center justify-center rounded-md border-2 border-border text-lg text-text"
      >
        Go to Trolley
      </Link>
    </AuthLayout>
  );
}

/** /connect?request=<id>: OAuth consent screen (stage 4, D-082..D-089). No bottom nav. */
export function ConnectPage() {
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const valid = /^[\w-]{1,128}$/.test(requestId);
  const { status, user, signOut } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);
  const [consentInvalid, setConsentInvalid] = useState(false);
  const signedIn = status === 'signedIn';

  const query = useQuery({
    queryKey: ['oauth-request', requestId],
    queryFn: () => getOAuthRequest(requestId),
    enabled: valid && signedIn,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (signedIn) clearPendingConnect();
  }, [signedIn]);

  if (!valid) return <InvalidLink />;
  if (status === 'loading') return <Splash />;
  if (!signedIn) {
    const path = `/connect?request=${encodeURIComponent(requestId)}`;
    rememberConnectPath(path);
    return <Navigate to="/sign-in" replace state={{ from: path } satisfies AuthRouteState} />;
  }
  if (consentInvalid || isNotFound(query.error)) return <InvalidLink />;

  async function decide(allow: boolean) {
    if (pending) return;
    setPending(allow ? 'allow' : 'deny');
    try {
      const { redirectUrl } = await sendOAuthConsent(requestId, allow);
      goExternal(redirectUrl); // stay busy while the browser leaves
    } catch (err) {
      setPending(null);
      if (isNotFound(err)) setConsentInvalid(true);
      else toast.show("Couldn't connect - try again");
    }
  }

  const details = query.data;

  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <div role="alert" className="text-center">
        <h1 className="text-xl">Couldn't load this connection</h1>
        <p className="mb-6 mt-2 text-base text-muted">
          {query.error instanceof ApiError
            ? 'Something went wrong. Please try again.'
            : "Can't reach Trolley right now."}
        </p>
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </div>
    );
  } else if (!details) {
    body = (
      <div aria-busy="true">
        <p className="sr-only">Loading connection details</p>
        <Skeleton className="mx-auto h-16 w-full rounded-md" />
        <Skeleton className="mt-3 h-24 w-full rounded-md" />
      </div>
    );
  } else {
    body = (
      <>
        <h1 className="break-words text-xl">
          Allow <span className="font-bold [overflow-wrap:anywhere]">{details.clientName}</span> to
          view and add to your Trolley lists?
        </h1>
        <p className="mt-2 break-all text-sm text-muted">
          You'll be sent back to {details.redirectHost}
        </p>

        <div className="mt-5 rounded-md bg-surface p-4">
          <p className="text-sm text-muted">It will be able to</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
            <li>See your lists</li>
            <li>Add and remove items on this week's list</li>
            <li>Search products</li>
          </ul>
          <p className="mt-3 text-sm text-muted">It can't delete lists.</p>
        </div>

        <p className="mt-5 break-all text-sm text-muted">
          Signed in as <span className="select-text">{user?.email}</span>
        </p>

        <div className="mt-4 space-y-3">
          <Button
            busy={pending === 'allow'}
            busyLabel="Connecting..."
            disabled={pending !== null}
            onClick={() => void decide(true)}
          >
            Allow
          </Button>
          <Button
            variant="secondary"
            busy={pending === 'deny'}
            busyLabel="Cancelling..."
            disabled={pending !== null}
            onClick={() => void decide(false)}
          >
            Deny
          </Button>
        </div>
        <div className="mt-2 text-center">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void signOut()}
            className="min-h-tap px-3 text-base font-semibold text-accent"
          >
            Not you? Sign out
          </button>
        </div>
      </>
    );
  }

  return (
    <AuthLayout>
      <Brand />
      {body}
    </AuthLayout>
  );
}
