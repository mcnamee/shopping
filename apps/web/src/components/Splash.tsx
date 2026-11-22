import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TrolleyGlyph } from './TrolleyGlyph';

/**
 * Full-screen splash while the session is restored (docs/ux/app-shell.md section 4).
 * Spinner appears after 300ms to avoid flicker; after 8s a slow-connection hint is added.
 */
export function Splash() {
  const [showSpinner, setShowSpinner] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const spinner = setTimeout(() => setShowSpinner(true), 300);
    const slowTimer = setTimeout(() => setSlow(true), 8000);
    return () => {
      clearTimeout(spinner);
      clearTimeout(slowTimer);
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-4 text-center">
      <TrolleyGlyph size={72} className="text-accent" />
      <p className="text-2xl">Trolley</p>
      <div className="flex h-6 items-center">
        {showSpinner && (
          <div role="status">
            <Loader2 aria-hidden className="h-6 w-6 animate-spin text-accent" />
            <span className="sr-only">Loading</span>
          </div>
        )}
      </div>
      {slow && <p className="text-base text-muted">Still loading... check your connection.</p>}
    </div>
  );
}
