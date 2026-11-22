import { useQuery } from '@tanstack/react-query';
import { getMe } from '../api';
import { useAuth } from '../auth';

/** Temporary page that proves auth + API plumbing end to end. Replace per docs/ux. */
export function PlaceholderPage({ title }: { title: string }) {
  const { signOut } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p data-testid="me">
        {me.isPending
          ? 'Loading…'
          : me.isError
            ? `Couldn't load your account (${me.error.message})`
            : `Signed in as ${me.data.email} (household ${me.data.householdId})`}
      </p>
      <button type="button" className="min-h-11 rounded border px-4" onClick={() => void signOut()}>
        Sign out
      </button>
    </section>
  );
}
