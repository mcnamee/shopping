import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UNIT_TYPES, type GroupSummary, type ProductSummary, type UnitType } from '@trolley/core';
import { CircleAlert, X } from 'lucide-react';
import { useId, useRef, useState, type RefObject } from 'react';
import { ApiError, createCustomProduct, searchProducts } from '../api';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { capitaliseFirst } from './format';
import { useDebouncedValue } from './hooks';
import { SegmentedControl } from './SegmentedControl';

const NAME_MAX = 80;

const UNIT_HELP: Record<UnitType, string> = {
  each: 'Counted one by one, like bananas.',
  pack: 'Sold as a packet or bottle, like a 1 kg bag of rice.',
  kg: 'Sold by weight, like loose potatoes.',
  g: 'Sold by weight, like loose potatoes.',
  L: 'Sold by volume, like milk.',
  mL: 'Sold by volume, like milk.',
};

const WEIGHED_GROUPS = new Set(['fruit-veg', 'meat-seafood']);
const defaultUnitFor = (groupId: string): UnitType => (WEIGHED_GROUPS.has(groupId) ? 'kg' : 'each');

interface CustomProductSheetProps {
  /** Name to prefill (the search query), or empty. */
  initialName: string;
  /** Group to prefill (active chip), else Other. */
  initialGroupId: string | undefined;
  groups: readonly GroupSummary[];
  onCreated: (product: ProductSummary) => void;
  /** Open the quantity modal for an existing custom product with the same name. */
  onUseExisting: (product: ProductSummary) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

function validateName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a name for this item.';
  if (name.length > NAME_MAX) return 'Keep it to 80 characters or fewer.';
  return null;
}

/** Custom product bottom sheet (docs/ux/search.md section 5). */
export function CustomProductSheet({
  initialName,
  initialGroupId,
  groups,
  onCreated,
  onUseExisting,
  onClose,
  returnFocusRef,
}: CustomProductSheetProps) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const { online } = useOnlineStatus();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLSelectElement>(null);

  const prefilled = initialName.trim().length > 0;
  const [name, setName] = useState(capitaliseFirst(initialName.trim()));
  const [groupId, setGroupId] = useState(
    groups.some((g) => g.id === initialGroupId) ? (initialGroupId as string) : 'other',
  );
  const [unit, setUnit] = useState<UnitType>(defaultUnitFor(groupId));
  const [unitTouched, setUnitTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  const [debouncedName] = useDebouncedValue(name.trim(), 250);
  const dupes = useQuery({
    queryKey: ['products', 'custom-dupes', debouncedName.toLowerCase()],
    queryFn: ({ signal }) => searchProducts({ q: debouncedName, limit: 24 }, signal),
    enabled: debouncedName.length >= 2 && online,
    staleTime: 10_000,
    retry: false,
  });
  const existing = dupes.data?.items.find(
    (p) => p.custom && p.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  const create = useMutation({
    mutationFn: createCustomProduct,
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onCreated(product);
    },
    onError: (err) => {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        (err.body as { field?: string })?.field === 'name'
      ) {
        setNameError(
          err.message.toLowerCase().includes('character')
            ? 'Keep it to 80 characters or fewer.'
            : 'Enter a name for this item.',
        );
        nameRef.current?.focus();
        return;
      }
      setSaveError(true);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending || !online) return;
    const err = validateName(name);
    setNameError(err);
    if (err) {
      nameRef.current?.focus();
      return;
    }
    setSaveError(false);
    create.mutate({ name: name.trim(), groupId, unitType: unit });
  };

  const onGroupChange = (id: string) => {
    setGroupId(id);
    if (!unitTouched) setUnit(defaultUnitFor(id));
  };

  const saving = create.isPending;
  const formId = `${headingId}-form`;

  return (
    <BottomSheet
      labelledBy={headingId}
      initialFocusRef={prefilled ? headingRef : nameRef}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      busy={saving}
      onClose={onClose}
      header={
        <div className="flex items-start gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="text-xl focus:outline-none"
            >
              Add a custom item
            </h2>
            <p className="mt-1 text-sm text-muted">
              For things not in the ALDI range, like butcher or market items.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm"
          >
            <X aria-hidden className="h-6 w-6" />
          </button>
        </div>
      }
      footer={
        <>
          {saveError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              Couldn't save that item. Please try again.
            </p>
          )}
          {!online && (
            <p className="text-sm text-warning-text">
              You're offline. Reconnect to save a custom item.
            </p>
          )}
          <Button
            type="submit"
            form={formId}
            busy={saving}
            busyLabel="Saving..."
            disabled={!online}
          >
            Save and choose quantity
          </Button>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-5 pt-2">
        <fieldset disabled={saving} className="space-y-5">
          <div>
            <TextField
              ref={nameRef}
              label="Name"
              value={name}
              required
              autoCapitalize="sentences"
              enterKeyHint="next"
              autoComplete="off"
              error={nameError}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              onBlur={() => {
                if (name.trim() || nameError) setNameError(validateName(name));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  groupRef.current?.focus();
                }
              }}
            />
            {existing && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <span>{`You already have a custom item called '${existing.name}'. Use it instead?`}</span>
                <button
                  type="button"
                  onClick={() => onUseExisting(existing)}
                  className="min-h-tap rounded-sm px-2 font-semibold text-accent underline"
                >
                  Use existing
                </button>
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${headingId}-group`} className="mb-1 block text-sm font-semibold">
              Group
            </label>
            <select
              ref={groupRef}
              id={`${headingId}-group`}
              value={groupId}
              onChange={(e) => onGroupChange(e.target.value)}
              className="block min-h-primary w-full rounded-md border-2 border-border bg-surface px-3 text-base text-text"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p id={`${headingId}-unit`} className="mb-1 text-sm font-semibold">
              How do you buy it?
            </p>
            <SegmentedControl
              label="How do you buy it?"
              options={UNIT_TYPES}
              value={unit}
              describedBy={`${headingId}-unit-help`}
              onChange={(u) => {
                setUnit(u);
                setUnitTouched(true);
              }}
            />
            <p id={`${headingId}-unit-help`} className="mt-2 text-sm text-muted">
              {UNIT_HELP[unit]}
              {(unit === 'each' || unit === 'pack') &&
                ' Weighed or measured items work best as kg or L.'}
            </p>
          </div>
        </fieldset>
      </form>
    </BottomSheet>
  );
}
