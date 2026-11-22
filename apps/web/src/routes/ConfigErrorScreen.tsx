import { TriangleAlert } from 'lucide-react';

/** Friendly start-up failure (config.json missing/invalid). Rendered outside the auth/query providers. */
export function ConfigErrorScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 pb-safe-bottom pt-safe-top text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert aria-hidden size={48} />
      </div>
      <h1 className="mt-5 text-2xl">Trolley couldn&apos;t start</h1>
      <p role="alert" className="mt-2 max-w-[320px] text-base text-muted">
        We couldn&apos;t load the app&apos;s settings. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 flex min-h-primary w-full max-w-[320px] items-center justify-center rounded-md bg-accent px-4 text-lg text-accent-on active:bg-accent-strong"
      >
        Try again
      </button>
    </main>
  );
}
