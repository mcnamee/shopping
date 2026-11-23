import { useQueryClient } from '@tanstack/react-query';
import {
  ENTITY_NAME_MAX_LENGTH,
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  isTemplateType,
  groupTemplateItems,
  sortTemplateItems,
  type Template,
  type TemplateItem,
  type TemplateType,
  type UnitType,
  type ProductSummary,
} from '@trolley/core';
import { CircleAlert, ListPlus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ApiError,
  addTemplateItem,
  createTemplate,
  deleteTemplate,
  deleteTemplateItem,
  saveUnitOverride,
  updateTemplate,
  updateTemplateItem,
} from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { useToast } from '../components/Toast';
import {
  ROLLBACK_MESSAGE,
  STALE_MESSAGE,
  isStale,
  qk,
  useAisleOrder,
  useListsQuery,
  useTemplateQuery,
  useTemplatesQuery,
  useUnitOverridesQuery,
} from '../lists/data';
import { qtyLabel } from '../lists/format';
import { NewListSheet } from '../lists/NewListSheet';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { ProductThumb } from '../search/ProductImage';
import { ModalError, QuantityModal, type QuantitySelection } from '../search/QuantityModal';
import { SegmentedControl } from '../search/SegmentedControl';
import { useDelayedFlag } from '../search/hooks';
import { AddToListSheet } from './AddToListSheet';

const HELPERS: Record<TemplateType, string> = {
  weekly: 'For items you buy most weeks. Pre-ticked when you start a new list.',
  meal: 'For a specific meal, like tacos. Add it to a list when you need it.',
  regulars: 'Things we buy now and then - review each shop.',
};
const UNDO_MS = 5000;

function productOf(item: TemplateItem, effectiveUnit: UnitType): ProductSummary {
  const p = item.product;
  return {
    sku: p.productId,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    price: null,
    unitPrice: null,
    packSize: p.packSize,
    unitType: effectiveUnit,
    defaultUnitType: p.unitType,
    groupId: p.groupId,
    custom: p.productId.startsWith('custom-'),
  };
}

const metaLine = (i: TemplateItem) => [i.product.packSize, i.note].filter(Boolean).join(' · ');

/** Create / edit a template (docs/ux/templates.md 2). Items save as you go; name and type with Save. */
export function TemplateEditorPage({ isNew = false }: { isNew?: boolean }) {
  const params = useParams();
  const id = isNew ? undefined : params['id'];
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();

  const query = useTemplateQuery(id);
  const tpl = query.data;
  const aisle = useAisleOrder();
  const overrides = useUnitOverridesQuery();
  const showSkeleton = useDelayedFlag(!isNew && query.isPending, 150);

  const initialType: TemplateType = isTemplateType(search.get('type'))
    ? (search.get('type') as TemplateType)
    : 'weekly';
  const baseline = { name: tpl?.name ?? '', type: tpl?.type ?? initialType };
  const [edits, setEdits] = useState<Partial<typeof baseline>>({});
  const form = { ...baseline, ...edits };
  const dirty =
    (edits.name !== undefined && edits.name !== baseline.name) ||
    (edits.type !== undefined && edits.type !== baseline.type);

  // Unsaved name/type: block in-app navigation (confirm sheet) and tab close/reload.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      currentLocation.pathname + currentLocation.search !==
        nextLocation.pathname + nextLocation.search,
  );
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<'failed' | 'stale' | null>(null);
  const [sheet, setSheet] = useState<null | 'delete' | 'add-to-list' | 'new-list'>(null);
  const [editing, setEditing] = useState<{ item: TemplateItem; opener: HTMLElement | null } | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const lists = useListsQuery(sheet === 'add-to-list' || sheet === 'new-list');
  const templates = useTemplatesQuery(sheet === 'new-list');

  const items = useMemo(() => (tpl ? sortTemplateItems(tpl.items, aisle) : []), [tpl, aisle]);
  const sections = useMemo(() => (tpl ? groupTemplateItems(tpl.items, aisle) : []), [tpl, aisle]);

  // Rows added elsewhere (Search) flash for 2 s when we come back.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tpl) return;
    const ids = tpl.items.map((i) => i.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((i) => !seen.current?.has(i));
    for (const i of ids) seen.current.add(i);
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 2000);
      return () => clearTimeout(t);
    }
  }, [tpl]);

  const validate = (name: string) => {
    const t = name.trim();
    if (!t) return 'Enter a name for this template.';
    if (t.length > ENTITY_NAME_MAX_LENGTH) return 'Keep it to 60 characters or fewer.';
    return null;
  };

  const setTemplateCache = (t: Template) => {
    qc.setQueryData(qk.template(t.id), t);
    void qc.invalidateQueries({ queryKey: qk.templates });
  };

  /** Save name and type (creating the template first time). Returns the saved id, or null. */
  const save = async (stay = true): Promise<string | null> => {
    const err = validate(form.name);
    setNameError(err);
    if (err) {
      nameRef.current?.focus();
      return null;
    }
    if (!online) return null;
    setSaving(true);
    setBanner(null);
    try {
      if (!tpl) {
        const created = await createTemplate({ name: form.name.trim(), type: form.type });
        setTemplateCache(created);
        toast.show(`Saved ${created.name}`);
        setEdits({});
        dirtyRef.current = false;
        if (stay) navigate(`/templates/${created.id}`, { replace: true });
        return created.id;
      }
      const updated = await updateTemplate(tpl.id, {
        ...(form.name.trim() !== tpl.name ? { name: form.name.trim() } : {}),
        ...(form.type !== tpl.type ? { type: form.type } : {}),
        version: tpl.version,
      });
      setTemplateCache(updated);
      setEdits({});
      dirtyRef.current = false;
      toast.show(`Saved ${updated.name}`);
      return updated.id;
    } catch (e) {
      setBanner(isStale(e) ? 'stale' : 'failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const addItems = async () => {
    let target = tpl?.id ?? null;
    if (!tpl || dirty) {
      target = await save();
      if (!target) return;
    }
    navigate(`/search?template=${target}`);
  };

  const showLatest = () => {
    setEdits({});
    setBanner(null);
    void query.refetch();
  };

  // ---- items
  const removeItem = async (item: TemplateItem) => {
    if (!tpl) return;
    const index = items.findIndex((i) => i.id === item.id);
    const nextId = items[index + 1]?.id ?? items[index - 1]?.id;
    const before = tpl;
    qc.setQueryData<Template>(qk.template(tpl.id), {
      ...tpl,
      items: tpl.items.filter((i) => i.id !== item.id),
      itemCount: tpl.itemCount - 1,
    });
    setAnnouncement(`Removed ${item.product.name}. ${tpl.itemCount - 1} items.`);
    requestAnimationFrame(() => {
      const next = nextId
        ? document.querySelector<HTMLElement>(`[data-item-edit="${CSS.escape(nextId)}"]`)
        : null;
      (next ?? addRef.current)?.focus();
    });
    try {
      const res = await deleteTemplateItem(tpl.id, item.id);
      setTemplateCache(res.template);
      toast.show(`Removed ${item.product.name}`, {
        durationMs: UNDO_MS,
        action: {
          label: 'Undo',
          onAction: () => {
            addTemplateItem(tpl.id, {
              productId: item.product.productId,
              qty: item.qty,
              unit: item.unit,
              note: item.note,
            }).then(
              (r) => setTemplateCache(r.template),
              () => toast.show(ROLLBACK_MESSAGE),
            );
          },
        },
      });
    } catch {
      qc.setQueryData(qk.template(tpl.id), before);
      toast.show(ROLLBACK_MESSAGE, {
        action: { label: 'Try again', onAction: () => void removeItem(item) },
      });
    }
  };

  const saveItem = async (item: TemplateItem, sel: QuantitySelection) => {
    if (!tpl) return;
    try {
      const res = await updateTemplateItem(tpl.id, item.id, {
        qty: sel.quantity,
        unit: sel.unit,
        note: sel.note || null,
        version: item.version,
      });
      setTemplateCache(res.template);
      if (sel.remember) {
        try {
          await saveUnitOverride(item.product.productId, sel.unit);
          void qc.invalidateQueries({ queryKey: qk.units });
        } catch {
          toast.show("Saved, but couldn't remember the unit.");
        }
      }
      setEditing(null);
    } catch (err) {
      if (isStale(err)) {
        setEditing(null);
        toast.show(STALE_MESSAGE);
        void qc.invalidateQueries({ queryKey: qk.template(tpl.id) });
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        throw new ModalError("That item isn't in this template any more.");
      }
      throw err;
    }
  };

  const removeTemplate = async () => {
    if (!tpl) return;
    try {
      await deleteTemplate(tpl.id);
      qc.removeQueries({ queryKey: qk.template(tpl.id) });
      void qc.invalidateQueries({ queryKey: qk.templates });
      toast.show(`Deleted ${tpl.name}`);
      dirtyRef.current = false;
      navigate('/templates', { replace: true });
    } catch {
      setSheet(null);
      toast.show(ROLLBACK_MESSAGE);
    }
  };

  const title = isNew ? 'New template' : (tpl?.name ?? 'Template');
  const leaving = blocker.state === 'blocked';
  const saveAndContinue = async () => {
    if (blocker.state !== 'blocked') return;
    if (await save(false)) blocker.proceed();
    else blocker.reset();
  };
  const discardAndContinue = () => {
    if (blocker.state !== 'blocked') return;
    dirtyRef.current = false;
    blocker.proceed();
  };

  if (!isNew && query.isPending) {
    return (
      <div aria-busy="true">
        <PageHeader title="Template" backTo="/templates" backLabel="Back to templates" />
        {showSkeleton && (
          <div className="space-y-3 px-4 pt-4">
            <p className="sr-only">Loading template</p>
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!isNew && !tpl) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        <PageHeader title="Template" backTo="/templates" backLabel="Back to templates" />
        {gone ? (
          <EmptyView Icon={ShoppingBasket} title="That template isn't here any more.">
            <Link
              to="/templates"
              className="flex min-h-primary items-center justify-center rounded-md bg-accent text-lg text-accent-on"
            >
              Back to templates
            </Link>
          </EmptyView>
        ) : (
          <ErrorView
            title="Couldn't load this template"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }

  const canSave = (dirty || isNew) && !saving;

  return (
    <div>
      <PageHeader
        title={title}
        backTo="/templates"
        backLabel="Back to templates"
        right={
          <button
            type="button"
            aria-disabled={!canSave || !online}
            onClick={() => canSave && online && void save()}
            className={`-mr-2 min-h-tap min-w-tap rounded-sm px-3 text-lg font-bold text-accent ${
              !canSave || !online ? 'opacity-40' : ''
            }`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        }
      >
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-xl focus:outline-none"
        >
          {title}
        </h1>
      </PageHeader>

      {banner === 'failed' && (
        <p
          role="alert"
          className="flex items-start gap-2 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger"
        >
          <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          Couldn't save that template. Please try again.
        </p>
      )}
      {banner === 'stale' && (
        <p
          role="alert"
          className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-sm font-semibold text-warning-text"
        >
          <span className="flex-1">Changed on another phone.</span>
          <button
            type="button"
            onClick={showLatest}
            className="min-h-tap rounded-sm px-2 font-bold underline"
          >
            Show latest
          </button>
        </p>
      )}

      <main className="space-y-5 px-[max(16px,var(--safe-left))] pb-4 pt-4">
        <div>
          <label htmlFor="template-name" className="mb-1 block text-sm font-semibold">
            Name
          </label>
          <input
            ref={nameRef}
            id="template-name"
            type="text"
            value={form.name}
            autoCapitalize="sentences"
            placeholder="e.g. Weekly basics"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'template-name-error' : undefined}
            onChange={(e) => {
              setEdits((s) => ({ ...s, name: e.target.value }));
              setNameError(null);
            }}
            onBlur={() => form.name !== '' && setNameError(validate(form.name))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canSave) void save();
              }
            }}
            className={`min-h-primary w-full rounded-md border-2 bg-surface px-3 text-lg ${
              nameError ? 'border-danger' : 'border-border'
            } focus:border-accent`}
          />
          {nameError && (
            <p id="template-name-error" className="mt-1 flex items-start gap-1 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {nameError}
            </p>
          )}
          {!online && dirty && (
            <p className="mt-1 text-sm text-muted">You're offline. Reconnect to save.</p>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold">Type</p>
          <SegmentedControl
            label="Template type"
            columns={3}
            options={TEMPLATE_TYPES}
            value={form.type}
            onChange={(type) => setEdits((s) => ({ ...s, type }))}
            optionLabel={(t) => TEMPLATE_TYPE_LABELS[t]}
          />
          <p className="mt-1 text-sm text-muted">{HELPERS[form.type]}</p>
        </div>

        <section aria-labelledby="items-label">
          <h2 id="items-label" className="mb-2 text-xs uppercase tracking-wide text-muted">
            Items ({items.length})
          </h2>
          {items.length === 0 ? (
            <div className="flex flex-col items-center rounded-md border-2 border-dashed border-border px-4 py-6 text-center">
              <ShoppingBasket aria-hidden className="h-8 w-8 text-muted" />
              <p className="mt-2 text-lg">No items yet</p>
              <p className="text-base text-muted">Add the things you buy for this.</p>
            </div>
          ) : (
            <div
              role="group"
              aria-label={`Items in ${tpl?.name ?? 'template'}`}
              className="space-y-3"
            >
              {sections.map((section) => (
                <section key={section.group.id} aria-labelledby={`tpl-group-${section.group.id}`}>
                  <h3
                    id={`tpl-group-${section.group.id}`}
                    className="mb-1 text-xs font-bold uppercase tracking-wide text-muted"
                  >
                    {section.group.name}
                  </h3>
                  <ul
                    aria-label={`${section.group.name} items in ${tpl?.name ?? 'template'}`}
                    className="overflow-hidden rounded-md bg-surface"
                  >
                    {section.items.map((item) => (
                      <li
                        key={item.id}
                        className={`flex min-h-16 items-center border-b border-border-subtle last:border-b-0 ${
                          fresh.has(item.id) ? 'bg-accent-soft' : ''
                        }`}
                      >
                        <button
                          type="button"
                          data-item-edit={item.id}
                          onClick={(e) => setEditing({ item, opener: e.currentTarget })}
                          className="flex min-h-16 min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left active:bg-accent-soft"
                        >
                          <ProductThumb src={item.product.imageUrl} name={item.product.name} />
                          <span className="min-w-0 flex-1">
                            <span className="sr-only">Edit</span>{' '}
                            <span className="line-clamp-2 break-words text-lg">
                              {item.product.name}
                            </span>
                            {metaLine(item) && (
                              <span className="block truncate text-sm font-normal text-muted">
                                {metaLine(item)}
                              </span>
                            )}
                          </span>
                          <span className="max-w-24 shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">
                            {qtyLabel(item.qty, item.unit)}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${item.product.name}`}
                          onClick={() => void removeItem(item)}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-muted active:bg-accent-soft"
                        >
                          <Trash2 aria-hidden className="h-5 w-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          <button
            ref={addRef as React.RefObject<HTMLButtonElement>}
            type="button"
            onClick={() => void addItems()}
            disabled={saving}
            className="mt-3 flex min-h-primary w-full items-center justify-center gap-2 rounded-md border-2 border-accent text-lg font-semibold text-accent active:bg-accent-soft"
          >
            <Plus aria-hidden className="h-5 w-5" />
            {saving ? 'Saving...' : 'Add items'}
          </button>
        </section>

        {tpl && (
          <div className="space-y-3">
            {items.length > 0 && (
              <Button variant="secondary" onClick={() => setSheet('add-to-list')}>
                <ListPlus aria-hidden className="h-5 w-5" />
                Add to a list
              </Button>
            )}
            <button
              type="button"
              onClick={() => setSheet('delete')}
              className="flex min-h-primary w-full items-center justify-center rounded-md text-lg font-semibold text-danger active:bg-danger-soft"
            >
              Delete template
            </button>
          </div>
        )}
      </main>

      {editing && !(overrides.isPending && !overrides.isError) && (
        <QuantityModal
          mode="edit"
          product={productOf(
            editing.item,
            overrides.data?.overrides.find((o) => o.productId === editing.item.product.productId)
              ?.unit ?? editing.item.product.unitType,
          )}
          initial={{
            quantity: editing.item.qty,
            unit: editing.item.unit,
            note: editing.item.note ?? '',
          }}
          onConfirm={(sel) => saveItem(editing.item, sel)}
          onFindInSearch={(product) => {
            setEditing(null);
            navigate(
              `/search?q=${encodeURIComponent(product.name)}&pin=${encodeURIComponent(product.sku)}`,
            );
          }}
          onClose={() => setEditing(null)}
          returnFocusRef={{ current: editing.opener }}
        />
      )}
      {leaving && (
        <ConfirmSheet
          title="Discard changes?"
          description="You've changed this template's name or type."
          confirm={saving ? 'Saving...' : 'Save and continue'}
          tone="primary"
          extra={{ label: 'Discard', onClick: discardAndContinue }}
          cancel="Keep editing"
          busy={saving}
          onConfirm={() => void saveAndContinue()}
          onCancel={() => blocker.reset?.()}
        />
      )}
      {sheet === 'delete' && tpl && (
        <ConfirmSheet
          title={`Delete ${tpl.name}?`}
          description="Lists you've already made from it won't change."
          confirm="Delete template"
          cancel="Cancel"
          onConfirm={() => void removeTemplate()}
          onCancel={() => setSheet(null)}
        />
      )}
      {sheet === 'add-to-list' && tpl && lists.data && (
        <AddToListSheet
          template={tpl}
          lists={lists.data?.lists ?? []}
          onNewList={() => setSheet('new-list')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'new-list' && tpl && lists.data && (
        <NewListSheet
          lists={lists.data?.lists ?? []}
          templates={templates.data?.templates ?? []}
          initialTemplateIds={[tpl.id]}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
