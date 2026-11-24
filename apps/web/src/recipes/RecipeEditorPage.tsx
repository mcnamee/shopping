import { useQueryClient } from '@tanstack/react-query';
import { RECIPE_LIMITS, type Recipe, type RecipeInput } from '@trolley/core';
import { Camera, CircleAlert, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { ApiError, createRecipe, deleteRecipe, getRecipePhotoUpload, updateRecipe } from '../api';
import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PageHeader } from '../components/PageHeader';
import { EmptyView, ErrorView, Skeleton } from '../components/StateViews';
import { TextField } from '../components/TextField';
import { useToast } from '../components/Toast';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { useDelayedFlag } from '../search/hooks';
import { uploadRecipePhoto } from '../api/recipePhotos';
import { ChefHat } from 'lucide-react';
import { prepareRecipePhoto, type PreparedPhoto } from './image';
import { rqk, useRecipeQuery } from './data';

const ING_HINT = 'One per line. Start a line with # for a heading.';
const METHOD_HINT = 'Leave a blank line between steps. Start a line with # for a heading.';
const PHOTO_FAILED = "Photo didn't upload. Try again.";
const STALE = 'Changed on the other phone';

interface FormState {
  title: string;
  description: string;
  categories: string[];
  yield: string;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  ingredients: string;
  instructions: string;
  notes: string;
  nutrition: string;
  sourceUrl: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  categories: [],
  yield: '',
  prepTime: '',
  cookTime: '',
  totalTime: '',
  ingredients: '',
  instructions: '',
  notes: '',
  nutrition: '',
  sourceUrl: '',
};

const fromRecipe = (r: Recipe): FormState => ({
  title: r.title,
  description: r.description,
  categories: r.categories,
  yield: r.yield,
  prepTime: r.prepTime,
  cookTime: r.cookTime,
  totalTime: r.totalTime,
  ingredients: r.ingredients,
  instructions: r.instructions,
  notes: r.notes,
  nutrition: r.nutrition,
  sourceUrl: r.sourceUrl,
});

type Photo =
  { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; prepared: PreparedPhoto; preview: string };

type Errors = Partial<Record<keyof FormState, string>>;

/** Client-side mirror of the server rules (RECIPE_LIMITS); the server stays the authority. */
export function validateRecipe(f: FormState): Errors {
  const e: Errors = {};
  const L = RECIPE_LIMITS;
  if (!f.title.trim()) e.title = 'Enter a title for this recipe.';
  else if (f.title.trim().length > L.title)
    e.title = `Keep the title to ${L.title} characters or fewer.`;
  const over = (k: keyof FormState, max: number, label: string) => {
    if (typeof f[k] === 'string' && (f[k] as string).length > max)
      e[k] = `Keep ${label} to ${max.toLocaleString('en-AU')} characters or fewer.`;
  };
  over('description', L.description, 'the description');
  over('yield', L.yield, 'this');
  over('prepTime', L.time, 'this');
  over('cookTime', L.time, 'this');
  over('totalTime', L.time, 'this');
  over('ingredients', L.ingredientChars, 'ingredients');
  over('instructions', L.instructions, 'the method');
  over('notes', L.notes, 'notes');
  over('nutrition', L.nutrition, 'nutrition');
  if (
    !e.ingredients &&
    f.ingredients.split(/\r?\n/).filter((l) => l.trim()).length > L.ingredientLines
  )
    e.ingredients = `Use up to ${L.ingredientLines} ingredient lines.`;
  const url = f.sourceUrl.trim();
  if (url) {
    if (url.length > L.sourceUrl) e.sourceUrl = 'That link is too long.';
    else if (!/^https?:\/\/\S+$/i.test(url))
      e.sourceUrl = 'Enter a link starting with http:// or https://.';
  }
  return e;
}

function Area({
  k,
  label,
  hint,
  value,
  error,
  rows = 4,
  onChange,
}: {
  k: string;
  label: string;
  hint?: string;
  value: string;
  error?: string | undefined;
  rows?: number;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-grow: size to content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  const id = `field-${k}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') ||
          undefined
        }
        className={`block min-h-[112px] w-full resize-none rounded-md border-2 bg-surface px-3 py-3 text-base leading-relaxed text-text ${
          error ? 'border-danger' : 'border-border'
        }`}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 flex items-start gap-1 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl">{title}</h2>
      {children}
    </div>
  );
}

/** Chip input for categories: type, then Enter or comma. */
function CategoryInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (t.length > RECIPE_LIMITS.category) {
      setError(`Keep each category to ${RECIPE_LIMITS.category} characters or fewer.`);
      return;
    }
    if (value.some((c) => c.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    if (value.length >= RECIPE_LIMITS.categories) {
      setError(`Use up to ${RECIPE_LIMITS.categories} categories.`);
      return;
    }
    setError(null);
    onChange([...value, t]);
    setDraft('');
  };
  return (
    <div>
      <TextField
        label="Categories"
        value={draft}
        error={error}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            const parts = v.split(',');
            parts.slice(0, -1).forEach(commit);
            setDraft(parts[parts.length - 1] ?? '');
          } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => commit(draft)}
        hint={<p className="mt-1 text-sm text-muted">Type a category, then Enter or comma.</p>}
      />
      {value.length > 0 && (
        <ul aria-label="Chosen categories" className="mt-2 flex flex-wrap gap-2">
          {value.map((c) => (
            <li
              key={c}
              className="flex items-center rounded-full bg-accent-soft pl-3 text-base text-accent"
            >
              {c}
              <button
                type="button"
                aria-label={`Remove ${c}`}
                onClick={() => onChange(value.filter((x) => x !== c))}
                className="flex h-11 w-11 items-center justify-center rounded-full"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Create or edit a recipe (docs/stages/stage-5.md D). */
export function RecipeEditorPage({ isNew = false }: { isNew?: boolean }) {
  const params = useParams();
  const id = isNew ? undefined : params['id'];
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { online } = useOnlineStatus();
  const query = useRecipeQuery(id);
  const recipe = query.data;
  const showSkeleton = useDelayedFlag(!isNew && query.isPending, 150);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [photo, setPhoto] = useState<Photo>({ kind: 'keep' });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Load (and reload after STALE) the recipe into the form, unless the person has edits.
  useEffect(() => {
    if (!recipe) return;
    if (loadedVersion === null || (!dirtyRef.current && recipe.version !== loadedVersion)) {
      setForm(fromRecipe(recipe));
      setLoadedVersion(recipe.version);
    }
  }, [recipe, loadedVersion]);

  useEffect(
    () => () => {
      if (photo.kind === 'new') URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setBanner(null);
    try {
      const prepared = await prepareRecipePhoto(file);
      setPhoto({ kind: 'new', prepared, preview: URL.createObjectURL(prepared.full) });
      setDirty(true);
    } catch {
      setBanner("Couldn't read that photo. Try a different one.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    const errs = validateRecipe(form);
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    if (!online) {
      setBanner("You're offline. Reconnect to save.");
      return;
    }
    setSaving(true);
    setBanner(null);
    let photoKey: string | null | undefined;
    if (photo.kind === 'new') {
      try {
        const upload = await getRecipePhotoUpload();
        await uploadRecipePhoto(upload, photo.prepared.full, photo.prepared.thumb);
        photoKey = upload.photoKey;
      } catch {
        setSaving(false);
        setBanner(PHOTO_FAILED);
        return;
      }
    } else if (photo.kind === 'remove') photoKey = null;
    const body: RecipeInput = {
      title: form.title.trim(),
      description: form.description,
      categories: form.categories,
      yield: form.yield.trim(),
      prepTime: form.prepTime.trim(),
      cookTime: form.cookTime.trim(),
      totalTime: form.totalTime.trim(),
      ingredients: form.ingredients,
      instructions: form.instructions,
      notes: form.notes,
      nutrition: form.nutrition,
      sourceUrl: form.sourceUrl.trim(),
      ...(photoKey !== undefined ? { photoKey } : {}),
    };
    try {
      const saved = recipe
        ? await updateRecipe(recipe.id, { ...body, version: recipe.version })
        : await createRecipe(body);
      qc.setQueryData(rqk.recipe(saved.id), saved);
      void qc.invalidateQueries({ queryKey: rqk.recipes });
      dirtyRef.current = false;
      toast.show(`Saved ${saved.title}`);
      navigate(`/recipes/${saved.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.body as { reason?: string } | null)?.reason === 'STALE'
      ) {
        // Reload the latest and drop the edits (D3).
        dirtyRef.current = false;
        setDirty(false);
        setPhoto({ kind: 'keep' });
        setLoadedVersion(null);
        toast.show(STALE);
        void qc.invalidateQueries({ queryKey: rqk.recipe(recipe?.id ?? '') });
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setBanner(err.message || `You can have up to ${RECIPE_LIMITS.recipes} recipes.`);
        return;
      }
      if (err instanceof ApiError && err.status === 400) {
        const field = (err.body as { field?: string } | null)?.field;
        if (field && field in EMPTY) setErrors({ [field]: err.message });
        else setBanner(err.message);
        return;
      }
      setBanner("Couldn't save. Check your connection and try again.");
    }
  };

  const remove = async () => {
    if (!recipe) return;
    try {
      await deleteRecipe(recipe.id);
      dirtyRef.current = false;
      qc.removeQueries({ queryKey: rqk.recipe(recipe.id) });
      void qc.invalidateQueries({ queryKey: rqk.recipes });
      toast.show(`Deleted ${recipe.title}`);
      navigate('/recipes', { replace: true });
    } catch {
      setConfirmDelete(false);
      toast.show("Couldn't delete. Check your connection.");
    }
  };

  const title = isNew ? 'Add recipe' : 'Edit recipe';
  const backTo = isNew || !recipe ? '/recipes' : `/recipes/${recipe.id}`;

  if (!isNew && !recipe) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        <PageHeader title={title} backTo="/recipes" backLabel="Back to Recipes" />
        {query.isPending ? (
          showSkeleton && (
            <div aria-busy="true" className="space-y-3 p-4">
              <p className="sr-only">Loading recipe</p>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          )
        ) : gone ? (
          <EmptyView
            Icon={ChefHat}
            title="Recipe not found"
            body="It may have been deleted on the other phone."
          >
            <Button onClick={() => navigate('/recipes', { replace: true })}>Back to Recipes</Button>
          </EmptyView>
        ) : (
          <ErrorView
            title="Couldn't load that recipe"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }

  const previewSrc =
    photo.kind === 'new'
      ? photo.preview
      : photo.kind === 'keep'
        ? (recipe?.photoUrl ?? null)
        : null;
  const err = (k: keyof FormState) => errors[k];

  return (
    <div className="pb-40">
      <PageHeader title={title} backTo={backTo} backLabel="Back" />
      <form
        noValidate
        className="space-y-8 px-[max(16px,var(--safe-left))] pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Fieldset title="Photo">
          <div className="relative overflow-hidden rounded-md bg-surface">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="Recipe photo preview"
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-accent-soft text-accent">
                <ChefHat aria-hidden className="h-12 w-12" />
              </div>
            )}
            {(saving || photoBusy) && photo.kind !== 'keep' && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg/60">
                <Loader2 aria-hidden className="h-8 w-8 animate-spin text-accent" />
                <span className="sr-only">{photoBusy ? 'Preparing photo' : 'Uploading photo'}</span>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            id="recipe-photo-input"
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Choose photo"
            className="hidden"
            tabIndex={-1}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={photoBusy || saving}
              onClick={() => fileRef.current?.click()}
            >
              <Camera aria-hidden className="h-5 w-5" />
              {previewSrc ? 'Replace photo' : 'Add photo'}
            </Button>
            {previewSrc && (
              <Button
                variant="secondary"
                disabled={photoBusy || saving}
                onClick={() => {
                  setPhoto({ kind: 'remove' });
                  setDirty(true);
                }}
              >
                Remove photo
              </Button>
            )}
          </div>
        </Fieldset>

        <Fieldset title="Basics">
          <TextField
            id="field-title"
            label="Title"
            value={form.title}
            maxLength={RECIPE_LIMITS.title + 20}
            error={err('title')}
            onChange={(e) => set('title', e.target.value)}
          />
          <Area
            k="description"
            label="Description"
            value={form.description}
            error={err('description')}
            rows={3}
            onChange={(v) => set('description', v)}
          />
          <CategoryInput value={form.categories} onChange={(v) => set('categories', v)} />
        </Fieldset>

        <Fieldset title="Times & yield">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              id="field-prepTime"
              label="Prep time"
              value={form.prepTime}
              error={err('prepTime')}
              onChange={(e) => set('prepTime', e.target.value)}
            />
            <TextField
              id="field-cookTime"
              label="Cook time"
              value={form.cookTime}
              error={err('cookTime')}
              onChange={(e) => set('cookTime', e.target.value)}
            />
            <TextField
              id="field-totalTime"
              label="Total time"
              value={form.totalTime}
              error={err('totalTime')}
              onChange={(e) => set('totalTime', e.target.value)}
            />
            <TextField
              id="field-yield"
              label="Serves"
              value={form.yield}
              error={err('yield')}
              onChange={(e) => set('yield', e.target.value)}
            />
          </div>
        </Fieldset>

        <Fieldset title="Ingredients">
          <Area
            k="ingredients"
            label="Ingredients"
            hint={ING_HINT}
            value={form.ingredients}
            error={err('ingredients')}
            rows={6}
            onChange={(v) => set('ingredients', v)}
          />
        </Fieldset>
        <Fieldset title="Method">
          <Area
            k="instructions"
            label="Method"
            hint={METHOD_HINT}
            value={form.instructions}
            error={err('instructions')}
            rows={6}
            onChange={(v) => set('instructions', v)}
          />
        </Fieldset>
        <Fieldset title="Notes">
          <Area
            k="notes"
            label="Notes"
            value={form.notes}
            error={err('notes')}
            rows={3}
            onChange={(v) => set('notes', v)}
          />
        </Fieldset>
        <Fieldset title="Nutrition">
          <Area
            k="nutrition"
            label="Nutrition"
            value={form.nutrition}
            error={err('nutrition')}
            rows={3}
            onChange={(v) => set('nutrition', v)}
          />
        </Fieldset>
        <Fieldset title="Source">
          <TextField
            id="field-sourceUrl"
            label="Source link"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={form.sourceUrl}
            error={err('sourceUrl')}
            onChange={(e) => set('sourceUrl', e.target.value)}
          />
        </Fieldset>

        {recipe && (
          <Button type="button" variant="danger-outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden className="h-5 w-5" />
            Delete recipe
          </Button>
        )}

        <div className="fixed inset-x-0 bottom-[var(--nav-height)] z-20 space-y-2 border-t border-border-subtle bg-surface px-[max(16px,var(--safe-left))] py-3">
          {banner && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
              {banner}
            </p>
          )}
          <Button type="submit" busy={saving} busyLabel="Saving..." disabled={!form.title.trim()}>
            Save
          </Button>
        </div>
      </form>

      {confirmDelete && recipe && (
        <ConfirmSheet
          title={`Delete ${recipe.title}?`}
          description="This can't be undone."
          confirm="Delete recipe"
          cancel="Cancel"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {blocker.state === 'blocked' && (
        <ConfirmSheet
          title="Discard changes?"
          description="You've changed this recipe but haven't saved it."
          confirm="Discard"
          cancel="Keep editing"
          onConfirm={() => {
            dirtyRef.current = false;
            blocker.proceed();
          }}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
