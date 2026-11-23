import { useQueryClient } from '@tanstack/react-query';
import {
  clampQuantity,
  formatQuantityNumber,
  isCountUnit,
  parseQuantity,
  quantityRules,
  sanitiseQuantityInput,
  stepQuantity,
  unitWord,
  type LineChange,
  type SuggestionsResponse,
  type Suggestion,
  type UnitType,
} from '@trolley/core';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Info,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import {
  addListItemsBulk,
  ApiError,
  getListSuggestions,
  getTemplate,
  getTemplates,
  undoListItemsBulk,
} from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { ProductThumb } from '../search/ProductImage';
import { qk, summaryOf, upsertListSummary, useAisleOrder } from './data';
import { SheetHeader } from './ListSheets';
import { shownPackSize } from './ShopRow';
import {
  addedMessage,
  countItems,
  groupSuggestions,
  summariseBulk,
  toBulkItems,
} from './suggestions';

const REASON_FALLBACK = 'Bought before';
const FULL_MESSAGE = 'Adding these would go over the 200 item limit. Untick a few and try again.';
const ADD_FAILED_MESSAGE = "Couldn't add those items. Please try again.";
const UNDO_FAILED_MESSAGE = "Couldn't undo. Check your connection.";
const CONFLICT_MESSAGE = 'Some items changed on another phone and were kept';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'limit'; message: string }
  | { kind: 'ready'; data: SuggestionsResponse };

export interface SuggestSheetProps {
  list: { id: string; name: string };
  /** `regulars`: review the household's Regulars templates, everything unticked to start. */
  mode?: 'suggest' | 'regulars' | 'template';
  /** `template` mode: the template to review, everything ticked to start. */
  template?: { id: string; name: string };
  /** `added` is true when rows were added (the sheet then shows its own toast). */
  onClose: (added: boolean) => void;
  /** Ids of every row added or merged into, so the list can highlight them. */
  onAdded?: (itemIds: string[]) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Items of one template as review rows. */
async function getTemplateSuggestions(
  id: string,
  signal: AbortSignal,
): Promise<SuggestionsResponse> {
  const t = await getTemplate(id);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const suggestions: Suggestion[] = t.items.map((i) => ({
    productId: i.product.productId,
    snapshot: i.product,
    qty: i.qty,
    unit: i.unit,
    note: i.note,
    reason: `On ${t.name}`,
    fromTemplate: false,
    fromHistory: false,
  }));
  return { source: 'rules', coldStart: false, note: null, suggestions };
}

/** Items of every Regulars template as review rows, one per product and unit. */
async function getRegularsSuggestions(signal: AbortSignal): Promise<SuggestionsResponse> {
  const { templates } = await getTemplates();
  const regulars = templates.filter((t) => t.type === 'regulars');
  const full = await Promise.all(regulars.map((t) => getTemplate(t.id)));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  for (const t of full) {
    for (const i of t.items) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      suggestions.push({
        productId: i.product.productId,
        snapshot: i.product,
        qty: i.qty,
        unit: i.unit,
        note: i.note,
        reason: `On ${t.name}`,
        fromTemplate: false,
        fromHistory: false,
      });
    }
  }
  return { source: 'rules', coldStart: false, note: null, suggestions };
}

/** Copy rotates once, never more (docs/ux/suggestions.md 2.1). */
function loadingCopy(seconds: number): string {
  if (seconds >= 8) return 'Nearly there...';
  if (seconds >= 4) return "Checking what's due this week...";
  return 'Looking at what you usually buy...';
}

/** Compact [-] value [+] stepper using the quantity modal rules (docs/ux/suggestions.md 2.2). */
function Stepper({
  name,
  unit,
  value,
  enabled,
  onChange,
  announce,
}: {
  name: string;
  unit: UnitType;
  value: number;
  enabled: boolean;
  onChange: (next: number) => void;
  announce: (message: string) => void;
}) {
  const [text, setText] = useState(() => formatQuantityNumber(value, unit));
  useEffect(() => setText(formatQuantityNumber(value, unit)), [value, unit]);
  const down = stepQuantity(value, unit, -1);
  const up = stepQuantity(value, unit, 1);
  const step = (next: number | null) => {
    if (!enabled || next === null) return;
    onChange(next);
    announce(`${name}, ${formatQuantityNumber(next, unit)} ${unitWord(unit, next)}`);
  };
  const commit = () => {
    if (!enabled) return;
    const parsed = parseQuantity(text, unit);
    if (parsed.ok) {
      onChange(parsed.value);
      return;
    }
    const n = Number(sanitiseQuantityInput(text));
    if (!Number.isFinite(n) || text.trim() === '') {
      setText(formatQuantityNumber(value, unit));
      return;
    }
    const clamped = clampQuantity(n, unit);
    onChange(clamped);
    setText(formatQuantityNumber(clamped, unit));
    announce(
      `Quantity set to ${formatQuantityNumber(clamped, unit)}, the ${
        n > quantityRules(unit).max ? 'maximum' : 'minimum'
      }`,
    );
  };
  const btn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border bg-surface disabled:opacity-40';
  return (
    <div
      role="group"
      aria-label={`Quantity for ${name}`}
      aria-disabled={!enabled || undefined}
      className="flex shrink-0 items-center"
    >
      <button
        type="button"
        aria-label={`Decrease quantity for ${name}`}
        disabled={!enabled || down === null}
        onClick={() => step(down)}
        className={btn}
      >
        <Minus aria-hidden className="h-5 w-5" />
      </button>
      <span className="flex min-w-14 items-center justify-center">
        <input
          type="text"
          inputMode={quantityRules(unit).decimals > 0 ? 'decimal' : 'numeric'}
          aria-label={`Quantity of ${name}`}
          value={text}
          readOnly={!enabled}
          onChange={(e) => setText(sanitiseQuantityInput(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="h-11 w-12 rounded-sm bg-transparent text-center text-lg font-bold"
        />
        {!isCountUnit(unit) && <span className="-ml-1 mr-1 text-sm text-muted">{unit}</span>}
      </span>
      <button
        type="button"
        aria-label={`Increase quantity for ${name}`}
        disabled={!enabled || up === null}
        onClick={() => step(up)}
        className={btn}
      >
        <Plus aria-hidden className="h-5 w-5" />
      </button>
    </div>
  );
}

function SuggestRow({
  suggestion,
  ticked,
  qty,
  onToggle,
  onQty,
  announce,
  showWeekly = true,
}: {
  suggestion: Suggestion;
  ticked: boolean;
  qty: number;
  onToggle: () => void;
  onQty: (next: number) => void;
  announce: (message: string) => void;
  showWeekly?: boolean;
}) {
  const id = useId();
  const { snapshot: p } = suggestion;
  const pack = shownPackSize(p.name, p.packSize);
  const reason = suggestion.reason || REASON_FALLBACK;
  return (
    <li className="flex min-h-[72px] items-center gap-1 border-b border-border-subtle">
      <button
        type="button"
        role="checkbox"
        aria-checked={ticked}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-why`}
        onClick={onToggle}
        className="flex min-h-[72px] min-w-0 flex-1 items-center gap-1 rounded-sm text-left"
      >
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-[6px] border-2 ${
              ticked ? 'border-accent bg-accent text-accent-on' : 'border-border bg-bg'
            }`}
          >
            {ticked && <Check className="h-4 w-4" strokeWidth={3} />}
          </span>
        </span>
        <ProductThumb src={p.imageUrl} name={p.name} dim={!ticked} />
        <span className={`min-w-0 flex-1 py-2 pl-2 ${ticked ? 'text-text' : 'text-muted'}`}>
          <span id={`${id}-name`} className="line-clamp-2 text-lg font-semibold">
            {p.name}
            {pack && <span className="font-normal text-muted"> {pack}</span>}
          </span>
          <span id={`${id}-why`} className="block text-sm text-muted">
            <span className="line-clamp-2">{reason}</span>
            {showWeekly && suggestion.fromTemplate && (
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 text-xs font-semibold text-muted">
                <LayoutTemplate aria-hidden className="h-3.5 w-3.5" />
                Weekly
              </span>
            )}
          </span>
        </span>
      </button>
      <Stepper
        name={p.name}
        unit={suggestion.unit}
        value={qty}
        enabled={ticked}
        onChange={onQty}
        announce={announce}
      />
    </li>
  );
}

function Centered({
  tone,
  Icon,
  title,
  body,
}: {
  tone: 'success' | 'accent';
  Icon: typeof CircleCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center px-2 pb-4 pt-6 text-center">
      <div
        className={`flex h-24 w-24 items-center justify-center rounded-full ${
          tone === 'success' ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent'
        }`}
      >
        <Icon aria-hidden size={48} />
      </div>
      <h3 className="mt-5 text-xl">{title}</h3>
      <p className="mt-2 max-w-[300px] text-base text-muted">{body}</p>
    </div>
  );
}

function LoadingBody({
  seconds,
  regulars,
  template,
}: {
  seconds: number;
  regulars: boolean;
  template: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 py-2">
        <Loader2 aria-hidden className="h-6 w-6 shrink-0 animate-spin text-accent" />
        <div>
          <p className="text-lg font-semibold">
            {regulars
              ? 'Loading your regulars...'
              : template
                ? 'Loading the template...'
                : loadingCopy(seconds)}
          </p>
          {seconds >= 3 && <p className="text-sm text-muted">This can take a few seconds.</p>}
        </div>
      </div>
      <div aria-hidden className="mt-3">
        {[0, 1].map((g) => (
          <div key={g}>
            <Skeleton className="my-3 h-4 w-28" />
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex h-16 items-center gap-3">
                <Skeleton className="h-6 w-6" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Review sheet for AI suggestions (docs/ux/suggestions.md). Fetches on open (cancellable),
 * lets the shopper tick and adjust, and writes nothing until "Add N items".
 */
export function SuggestSheet({
  list,
  mode = 'suggest',
  template,
  onClose,
  onAdded,
  returnFocusRef,
}: SuggestSheetProps) {
  const fromTemplate = mode === 'template' && template !== undefined;
  const regulars = mode === 'regulars';
  /** Reviewing saved items (Regulars or one template) rather than AI suggestions. */
  const review = regulars || fromTemplate;
  const templateId = template?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const aisle = useAisleOrder();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const [qtys, setQtys] = useState<ReadonlyMap<number, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [live, setLive] = useState(
    regulars
      ? 'Loading your regulars'
      : fromTemplate
        ? 'Loading the template'
        : 'Looking for suggestions',
  );

  // ---- fetch (aborted on Cancel, Close or unmount)
  useEffect(() => {
    const ctrl = new AbortController();
    setPhase({ kind: 'loading' });
    setSeconds(0);
    (fromTemplate && templateId
      ? getTemplateSuggestions(templateId, ctrl.signal)
      : regulars
        ? getRegularsSuggestions(ctrl.signal)
        : getListSuggestions(list.id, ctrl.signal)
    ).then(
      (data) => {
        setOff(regulars ? new Set(data.suggestions.map((_, i) => i)) : new Set());
        setQtys(new Map());
        setPhase({ kind: 'ready', data });
        const n = data.suggestions.length;
        setLive(
          n > 0
            ? `${regulars ? 'Regulars' : fromTemplate ? 'Template' : 'Suggestions'} ready, ${countItems(n)}`
            : data.coldStart
              ? 'Nothing to suggest yet'
              : "You're all set",
        );
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError && err.status === 429) {
          setPhase({ kind: 'limit', message: err.message });
        } else setPhase({ kind: 'error' });
      },
    );
    return () => ctrl.abort();
  }, [list.id, attempt, regulars, fromTemplate, templateId]);

  useEffect(() => {
    if (phase.kind !== 'loading') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  const suggestions = useMemo(
    () => (phase.kind === 'ready' ? phase.data.suggestions : []),
    [phase],
  );
  const sections = useMemo(() => groupSuggestions(suggestions, aisle), [suggestions, aisle]);
  const qtyOf = (i: number) => qtys.get(i) ?? (suggestions[i] as Suggestion).qty;
  const count = suggestions.length - off.size;

  const toggle = (i: number) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      setLive(`${suggestions.length - n.size} of ${suggestions.length} selected`);
      return n;
    });
  const allOn = off.size === 0;
  const toggleAll = () => {
    setOff(allOn ? new Set(suggestions.map((_, i) => i)) : new Set());
    setLive(allOn ? `0 of ${suggestions.length} selected` : `All ${suggestions.length} selected`);
  };

  const undoAdd = (changes: LineChange[]) => {
    void undoListItemsBulk(list.id, changes)
      .then((res) => {
        qc.setQueryData(qk.list(list.id), res.list);
        upsertListSummary(qc, summaryOf(res.list));
        toast.show(
          res.results.some((r) => !r.ok && r.code === 'CONFLICT')
            ? CONFLICT_MESSAGE
            : `Removed ${countItems(res.undone)}`,
        );
      })
      .catch(() =>
        toast.show(UNDO_FAILED_MESSAGE, {
          durationMs: 8000,
          action: { label: 'Try again', onAction: () => undoAdd(changes) },
        }),
      )
      .finally(() => {
        void qc.invalidateQueries({ queryKey: qk.list(list.id) });
        void qc.invalidateQueries({ queryKey: qk.lists });
      });
  };

  const confirm = async () => {
    if (busy) return;
    if (count === 0) {
      setLive('Tick at least one item');
      return;
    }
    const picks = suggestions
      .map((suggestion, i) => ({ suggestion, qty: qtyOf(i), i }))
      .filter((p) => !off.has(p.i));
    setBusy(true);
    setBanner(null);
    try {
      const res = await addListItemsBulk(list.id, toBulkItems(picks));
      const sum = summariseBulk(res.results);
      if (res.added === 0) {
        setBusy(false);
        setBanner(sum.limitHit ? FULL_MESSAGE : ADD_FAILED_MESSAGE);
        return;
      }
      onAdded?.(sum.itemIds);
      qc.setQueryData(qk.list(list.id), res.list);
      upsertListSummary(qc, summaryOf(res.list));
      void qc.invalidateQueries({ queryKey: qk.lists });
      toast.show(addedMessage(picks.length, res.added, sum.combined), {
        durationMs: 8000,
        action: { label: 'Undo', onAction: () => undoAdd(sum.changes) },
      });
      onClose(true);
    } catch {
      setBusy(false);
      setBanner(ADD_FAILED_MESSAGE);
    }
  };

  const close = () => onClose(false);
  const note = phase.kind === 'ready' ? phase.data.note : null;
  const coldStart = phase.kind === 'ready' && phase.data.coldStart;

  let body;
  let footer;
  if (phase.kind === 'loading') {
    body = <LoadingBody seconds={seconds} regulars={regulars} template={fromTemplate} />;
    footer = (
      <Button variant="secondary" onClick={close}>
        Cancel
      </Button>
    );
  } else if (phase.kind === 'limit') {
    body = (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-sm bg-warning-soft px-3 py-3 text-base font-semibold text-warning-text"
      >
        <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        {phase.message}
      </p>
    );
    footer = <Button onClick={close}>Close</Button>;
  } else if (phase.kind === 'error') {
    body = (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-base font-semibold text-danger"
      >
        <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        {regulars
          ? "Couldn't load your regulars right now."
          : fromTemplate
            ? "Couldn't load that template right now."
            : "Couldn't get suggestions right now."}
      </p>
    );
    footer = (
      <>
        <Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </>
    );
  } else if (suggestions.length === 0) {
    body = fromTemplate ? (
      <Centered
        tone="accent"
        Icon={ListChecks}
        title="Nothing in this template"
        body="Add items to it from Templates and they will show up here to review."
      />
    ) : regulars ? (
      <Centered
        tone="accent"
        Icon={ListChecks}
        title="No regulars yet"
        body="Add items to a Regulars template and they will show up here to review."
      />
    ) : coldStart ? (
      <Centered
        tone="accent"
        Icon={ListChecks}
        title="Nothing to suggest yet"
        body={
          note ??
          'Not enough history yet. Suggestions get smarter after a few shops, or add a Weekly template to start with.'
        }
      />
    ) : (
      <Centered
        tone="success"
        Icon={CircleCheck}
        title="You're all set"
        body="Nothing else looks due this week."
      />
    );
    footer = review ? (
      <Button onClick={close}>Done</Button>
    ) : coldStart ? (
      <>
        <Button
          onClick={() => {
            close();
            navigate('/templates');
          }}
        >
          Go to Templates
        </Button>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </>
    ) : (
      <Button onClick={close}>Done</Button>
    );
  } else {
    body = (
      <div>
        {coldStart && note && (
          <p className="mb-2 flex items-start gap-2 rounded-sm bg-accent-soft px-3 py-3 text-sm">
            <Info aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            {note}
          </p>
        )}
        <div className="sticky top-0 z-20 flex min-h-11 items-center justify-between gap-2 bg-bg">
          <p aria-live="polite" className="text-sm text-muted">
            {suggestions.length - off.size} of {suggestions.length} selected
          </p>
          <button
            type="button"
            onClick={toggleAll}
            className="min-h-tap rounded-sm px-2 text-base font-semibold text-accent underline"
          >
            {allOn ? 'Select none' : 'Select all'}
          </button>
        </div>
        {sections.map((s) => (
          <section key={s.group.id} role="group" aria-labelledby={`${headingId}-${s.group.id}`}>
            <h3
              id={`${headingId}-${s.group.id}`}
              className="sticky top-11 z-10 flex h-10 items-center justify-between bg-bg text-xs uppercase tracking-wide text-muted"
            >
              {s.group.name}
              <span aria-hidden>{s.items.length}</span>
            </h3>
            <ul>
              {s.items.map(({ index, suggestion }) => (
                <SuggestRow
                  key={`${suggestion.productId}-${suggestion.unit}`}
                  suggestion={suggestion}
                  ticked={!off.has(index)}
                  qty={qtyOf(index)}
                  onToggle={() => toggle(index)}
                  onQty={(next) => setQtys((m) => new Map(m).set(index, next))}
                  announce={setLive}
                  showWeekly={!review}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
    footer = (
      <>
        {banner && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm font-semibold text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
            {banner}
          </p>
        )}
        <Button
          busy={busy}
          busyLabel="Adding..."
          aria-disabled={count === 0}
          onClick={() => void confirm()}
        >
          {count === 0 ? 'Add items' : `Add ${countItems(count)}`}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={close}>
          Cancel
        </Button>
      </>
    );
  }

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={heading}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      busy={busy}
      onClose={close}
      header={
        <SheetHeader
          id={headingId}
          title={
            regulars ? 'Review regulars' : fromTemplate ? `Add ${template.name}` : 'Suggested items'
          }
          headingRef={heading}
          onClose={close}
        />
      }
      footer={footer}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {live}
      </div>
      {body}
    </BottomSheet>
  );
}
