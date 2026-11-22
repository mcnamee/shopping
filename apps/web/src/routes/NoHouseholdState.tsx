import { UserRoundX } from 'lucide-react';

/** Shown in place of tab content when /api/me returns 403 NO_HOUSEHOLD. */
export function NoHouseholdState() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--safe-top)-56px-var(--nav-height)-48px)] flex-col items-center justify-center text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-soft text-accent">
        <UserRoundX aria-hidden size={48} />
      </div>
      <h2 className="mt-5 text-xl">Your account isn&apos;t set up yet</h2>
      <p className="mt-2 max-w-[280px] text-base text-muted">
        Your email isn&apos;t linked to a household. Ask your household admin to finish setting it
        up, then sign in again.
      </p>
      <p className="mt-2 max-w-[280px] text-base text-muted">
        You can sign out from the Settings tab.
      </p>
    </div>
  );
}
