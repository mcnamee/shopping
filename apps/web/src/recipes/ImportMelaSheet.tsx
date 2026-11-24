import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, ImageIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, createRecipe, getRecipePhotoUpload } from '../api';
import { uploadRecipePhoto } from '../api/recipePhotos';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { SheetHeader } from '../lists/ListSheets';
import { rqk, useRecipesQuery } from './data';
import { prepareRecipePhoto } from './image';
import {
  isDuplicate,
  melaSourceId,
  parseMelaFiles,
  runMelaImport,
  sniffImageType,
  type ImportDeps,
  type ImportSummary,
  type MelaParseResult,
} from './mela';

type Phase =
  | { kind: 'reading' }
  | { kind: 'preview'; parsed: MelaParseResult }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; summary: ImportSummary };

function describeError(err: unknown): { reason: string; limit: boolean } {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.code === 'LIMIT') {
      return { reason: 'Recipe limit reached', limit: true };
    }
    return { reason: err.message || 'The server refused it', limit: false };
  }
  return { reason: "Couldn't reach Trolley", limit: false };
}

const deps: ImportDeps = {
  async uploadPhoto(bytes) {
    const prepared = await prepareRecipePhoto(
      new Blob([bytes as BlobPart], { type: sniffImageType(bytes) }),
    );
    const upload = await getRecipePhotoUpload();
    await uploadRecipePhoto(upload, prepared.full, prepared.thumb);
    return upload.photoKey;
  },
  create: (input) => createRecipe(input),
  describeError,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Import from Mela (B-019): read the picked files, preview with duplicates flagged,
 * import one by one with progress and Cancel, then a summary.
 */
export function ImportMelaSheet({ files, onClose }: { files: File[]; onClose: () => void }) {
  const qc = useQueryClient();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const existing = useRecipesQuery();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void parseMelaFiles(files).then((parsed) => live && setPhase({ kind: 'preview', parsed }));
    return () => {
      live = false;
    };
  }, [files]);

  const known = existing.data?.recipes;
  const parsed = phase.kind === 'preview' ? phase.parsed : null;
  const dupes = useMemo(
    () => (parsed ? parsed.recipes.map((r) => isDuplicate(r, known ?? [])) : []),
    [parsed, known],
  );
  const selectable = dupes.flatMap((d, i) => (d ? [] : [i]));
  const chosen = selectable.filter((i) => !off.has(i));
  const allOn = chosen.length === selectable.length;
  const [live, setLive] = useState('');

  const toggle = (i: number) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const start = async () => {
    if (!parsed || chosen.length === 0) return;
    const recipes = chosen.flatMap((i) => parsed.recipes[i] ?? []);
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ kind: 'running', done: 0, total: recipes.length });
    const summary = await runMelaImport(deps, {
      recipes,
      existingCount: known?.length ?? 0,
      skippedDuplicates: dupes.filter(Boolean).length,
      signal: ctl.signal,
      onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
    });
    abort.current = null;
    void qc.invalidateQueries({ queryKey: rqk.recipes });
    setPhase({ kind: 'done', summary });
  };

  const running = phase.kind === 'running';
  // Closing mid-import cancels it; the summary then shows what was done.
  const close = running ? () => abort.current?.abort() : onClose;
  const title = phase.kind === 'done' ? 'Import finished' : 'Import from Mela';

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (phase.kind === 'reading') {
    body = (
      <p role="status" className="py-6 text-center text-lg text-muted">
        Reading your files...
      </p>
    );
    footer = (
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    );
  } else if (phase.kind === 'preview') {
    const n = phase.parsed.recipes.length;
    const dupCount = dupes.filter(Boolean).length;
    body = (
      <>
        <div role="status" aria-live="polite" className="sr-only">
          {live}
        </div>
        {phase.parsed.problems.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger">
            {phase.parsed.problems.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        )}
        {n === 0 ? (
          <p className="py-6 text-center text-lg">
            No recipes found. Pick a .melarecipe or .melarecipes file exported from Mela.
          </p>
        ) : (
          <>
            <p className="text-lg font-semibold">Found {plural(n, 'recipe')}</p>
            {existing.isPending && (
              <p className="text-sm text-muted">Checking what is already in Trolley...</p>
            )}
            <div className="sticky -top-1 z-20 flex min-h-12 items-center justify-between gap-2 bg-bg pt-1">
              <p aria-hidden className="text-sm text-muted">
                {chosen.length} of {selectable.length} selected
                {dupCount > 0 ? `, ${dupCount} already here` : ''}
              </p>
              <button
                type="button"
                onClick={() => {
                  setOff(allOn ? new Set(selectable) : new Set());
                  setLive(allOn ? 'None selected' : 'All selected');
                }}
                className="min-h-tap rounded-sm px-2 text-base font-semibold text-accent underline"
              >
                {allOn ? 'Select none' : 'Select all'}
              </button>
            </div>
            <ul aria-label="Recipes found">
              {phase.parsed.recipes.map((r, i) => {
                const dupe = dupes[i];
                const on = !dupe && !off.has(i);
                return (
                  <li key={`${melaSourceId(r)}-${i}`} className="border-b border-border-subtle">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={dupe}
                      onClick={() => toggle(i)}
                      className="flex min-h-14 w-full items-center gap-1 rounded-sm text-left disabled:opacity-60"
                    >
                      <span
                        aria-hidden
                        className="flex h-11 w-11 shrink-0 items-center justify-center"
                      >
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 ${
                            on ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
                          }`}
                        >
                          {on && <Check className="h-4 w-4" strokeWidth={3} />}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 py-2">
                        <span className="block break-words text-lg">{r.title}</span>
                        <span className="flex items-center gap-2 text-sm text-muted">
                          {r.image && (
                            <span className="flex items-center gap-1">
                              <ImageIcon aria-hidden className="h-4 w-4" />
                              Photo
                            </span>
                          )}
                          {dupe && <span>Already in Trolley - will skip</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </>
    );
    footer = (
      <>
        {n > 0 && (
          <Button
            aria-disabled={chosen.length === 0 || existing.isPending}
            onClick={() => {
              if (!existing.isPending) void start();
            }}
          >
            {chosen.length === 0 ? 'Import' : `Import ${chosen.length}`}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </>
    );
  } else if (phase.kind === 'running') {
    body = (
      <div className="py-6" aria-busy="true">
        <p role="status" className="text-center text-lg">
          Importing {Math.min(phase.done + 1, phase.total)} of {phase.total}...
        </p>
        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={phase.total}
          aria-valuenow={phase.done}
          className="mx-auto mt-4 h-2 w-full overflow-hidden rounded-full bg-border-subtle"
        >
          <div
            className="h-full bg-accent"
            style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }}
          />
        </div>
      </div>
    );
    footer = (
      <Button variant="secondary" onClick={() => abort.current?.abort()}>
        Cancel
      </Button>
    );
  } else {
    const s = phase.summary;
    body = (
      <div>
        <p role="status" className="text-lg font-semibold">
          {s.cancelled ? 'Import cancelled. ' : ''}
          {plural(s.imported, 'recipe')} imported
        </p>
        <ul className="mt-2 space-y-1 text-base">
          <li>Skipped duplicates: {s.skippedDuplicates}</li>
          <li>Failed: {s.failed}</li>
        </ul>
        {s.outcomes.length > 0 && (
          <ul aria-label="Details" className="mt-3 space-y-2 text-sm">
            {s.outcomes.map((o, i) => (
              <li key={i} className="rounded-sm bg-surface px-3 py-2">
                <span className="font-semibold">{o.title}</span>
                <span className={`block ${o.status === 'failed' ? 'text-danger' : 'text-muted'}`}>
                  {o.status === 'failed' ? o.reason : o.notes.join('. ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
    footer = <Button onClick={onClose}>Done</Button>;
  }

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      busy={running}
      onClose={close}
      header={<SheetHeader id={headingId} title={title} headingRef={heading} onClose={close} />}
      footer={footer}
    >
      {body}
    </BottomSheet>
  );
}
