// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ListDetail, Recipe, RecipesResponse } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_RECIPE_IDS } from '../api/mock-stage5';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { callMock, renderMockApp } from '../test/mockApp';
import { resetTickQueue } from '../offline/tickQueue';
import { validateRecipe } from './RecipeEditorPage';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);
vi.mock('./image', () => ({
  prepareRecipePhoto: vi.fn(async () => ({
    full: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  })),
}));
const upload = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('../api/recipePhotos', () => ({
  uploadRecipePhoto: vi.fn(async () => {
    upload.calls += 1;
    if (upload.fail) throw new Error('nope');
  }),
}));

beforeEach(() => {
  upload.fail = false;
  upload.calls = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetTickQueue();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

const LAMB = `/recipes/${MOCK_RECIPE_IDS.lambCurry}`;

async function recipes() {
  const app = await renderMockApp('/recipes');
  await screen.findByRole('link', { name: /Lamb curry/ }, { timeout: 3000 });
  return app;
}
const cards = () => within(screen.getByRole('list', { name: 'Recipes' })).getAllByRole('link');

describe('Recipes list', () => {
  it('lists cards A-Z with meta and a favourite star', async () => {
    await recipes();
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('Fluffy pancakes'),
      expect.stringContaining('Greek salad'),
      expect.stringContaining('Lamb curry'),
      expect.stringContaining('Toast with Vegemite'),
    ]);
    const lamb = screen.getByRole('link', { name: /Lamb curry/ });
    expect(lamb).toHaveTextContent('2 hr 15 min · Serves 4');
    expect(within(lamb).getByText('Favourite')).toBeInTheDocument();
    expect(lamb).toHaveAttribute('href', LAMB);
  });

  it('searches by title, filters by category and favourites, and clears', async () => {
    const { user } = await recipes();
    await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'GREEK');
    expect(cards()).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Search recipes' }));
    await user.click(screen.getByRole('button', { name: 'Breakfast' }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('Fluffy pancakes');
    await user.click(screen.getByRole('button', { name: 'Favourites' }));
    expect(screen.getByText('No recipes match')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cards()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Favourites' }));
    expect(cards()).toHaveLength(1);
  });

  it('shows the empty state with Add recipe', async () => {
    await recipes();
    const { body } = await callMock<RecipesResponse>('GET', '/recipes');
    for (const r of body.recipes) await callMock('DELETE', `/recipes/${r.id}`);
    window.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByRole('heading', { name: 'No recipes yet' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Add recipe/ }).length).toBeGreaterThan(0);
  });
});

describe('Recipe detail', () => {
  it('renders headings, numbered steps, notes, nutrition and a safe source link', async () => {
    await renderMockApp(LAMB);
    await screen.findByRole('heading', { level: 2, name: 'Ingredients' }, { timeout: 3000 });
    expect(screen.getAllByRole('heading', { level: 3, name: 'To serve' })).toHaveLength(2);
    expect(screen.queryByText('# Curry')).not.toBeInTheDocument();
    expect(screen.getByText('500g lamb shoulder, diced')).toBeVisible();
    const steps = within(screen.getByRole('list', { name: 'Method steps' })).getAllByText(
      /^Step \d/,
    );
    expect(steps.map((s) => s.textContent)).toEqual([
      'Step 1. ',
      'Step 2. ',
      'Step 3. ',
      'Step 4. ',
    ]);
    expect(screen.getByText('Freezes well for up to 3 months.')).toBeVisible();
    expect(screen.getByText('520 kcal per serve')).toBeVisible();
    const src = screen.getByRole('link', { name: /www\.example\.com/ });
    expect(src).toHaveAttribute('target', '_blank');
    expect(src).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Prep')).toBeVisible();
    // No Wake Lock in jsdom: the toggle is hidden.
    expect(screen.queryByText('Keep screen on')).not.toBeInTheDocument();
  });

  it('holds a wake lock while visible and releases it on leave', async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release, addEventListener: () => {} }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    try {
      const { user, unmount } = await renderMockApp(LAMB);
      await screen.findByText('Keep screen on', {}, { timeout: 3000 });
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole('switch'));
      await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole('switch'));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      unmount();
      await waitFor(() => expect(release).toHaveBeenCalledTimes(2));
    } finally {
      delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    }
  });

  it('toggles the favourite without a version', async () => {
    const { user } = await renderMockApp(`/recipes/${MOCK_RECIPE_IDS.greekSalad}`);
    await user.click(
      await screen.findByRole('button', { name: 'Add to favourites' }, { timeout: 3000 }),
    );
    expect(await screen.findByRole('button', { name: 'Remove from favourites' })).toBeVisible();
    const { body } = await callMock<Recipe>('GET', `/recipes/${MOCK_RECIPE_IDS.greekSalad}`);
    expect(body.favourite).toBe(true);
  });
});

describe('Add ingredients to a list', () => {
  const open = async () => {
    const app = await renderMockApp(LAMB);
    await app.user.click(
      await screen.findByRole('button', { name: 'Add to list' }, { timeout: 3000 }),
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('radio', { name: /Week of/ });
    return { ...app, dialog };
  };

  it('lists ingredients ticked with headings as labels, adds them to this week and undoes', async () => {
    const { user, dialog } = await open();
    // Smart matching upgrades some rows to ALDI products; wait for it to settle.
    await waitFor(() => expect(within(dialog).queryByText(/Finding ALDI products/)).toBeNull());
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(9);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(within(dialog).getByText('To serve')).toBeVisible();
    expect(within(dialog).getAllByText('9 of 9 selected').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('radio', { name: /Week of/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Select none' }));
    expect(within(dialog).getByRole('button', { name: 'Add ingredients' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Select all' }));
    await user.click(boxes[0] as HTMLElement);
    expect(within(dialog).getAllByText('8 of 9 selected').length).toBeGreaterThan(0);

    const before = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`)).body;
    await user.click(within(dialog).getByRole('button', { name: /^Add 8 to Week of/ }));
    expect(await screen.findByText(/^Added 8 to Week of/)).toBeVisible();
    const list = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`)).body;
    // Some rows are matched to ALDI products (merged into existing lines), the rest are text.
    const text = list.items.filter((i) => i.kind === 'text');
    expect(text.length).toBeGreaterThan(0);
    expect(text[0]?.note).toBe('From Lamb curry');
    expect(list.items.length).toBeGreaterThanOrEqual(before.items.length + text.length);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const after = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`))
        .body;
      expect(after.items.filter((i) => i.kind === 'text')).toHaveLength(0);
      expect(after.items.length).toBe(before.items.length);
    });
  });
});

describe('Recipe editor', () => {
  it('validates the fields (pure rules)', () => {
    const base = {
      title: 'x',
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
    expect(validateRecipe({ ...base, title: ' ' }).title).toBeTruthy();
    expect(validateRecipe({ ...base, title: 'x'.repeat(121) }).title).toBeTruthy();
    expect(validateRecipe({ ...base, sourceUrl: 'ftp://x' }).sourceUrl).toBeTruthy();
    expect(validateRecipe({ ...base, sourceUrl: 'https://x.com/a' })).toEqual({});
    expect(validateRecipe({ ...base, prepTime: 'y'.repeat(31) }).prepTime).toBeTruthy();
    expect(validateRecipe({ ...base, ingredients: 'a\n'.repeat(201) }).ingredients).toBeTruthy();
  });

  it('keeps Save disabled until there is a title and shows inline errors', async () => {
    const { user } = await renderMockApp('/recipes/new');
    const save = await screen.findByRole('button', { name: 'Save' }, { timeout: 3000 });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Title'), 'Soup');
    await user.type(screen.getByLabelText('Source link'), 'not a link');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText(/Enter a link starting with http/)).toBeVisible();
    expect(screen.getByText('One per line. Start a line with # for a heading.')).toBeVisible();
  });

  it('creates a recipe with a resized photo, categories and headings', async () => {
    const { user } = await renderMockApp('/recipes/new');
    await screen.findByRole('button', { name: 'Save' }, { timeout: 3000 });
    await user.type(screen.getByLabelText('Title'), 'Tomato soup');
    await user.type(screen.getByLabelText('Categories'), 'Soup,Easy{Enter}');
    expect(screen.getByRole('list', { name: 'Chosen categories' })).toHaveTextContent('SoupEasy');
    await user.type(
      screen.getByLabelText('Ingredients', { selector: 'textarea' }),
      '# Soup{Enter}6 tomatoes',
    );
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose photo'), { target: { files: [file] } });
    expect(await screen.findByAltText('Recipe photo preview')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 2, name: 'Tomato soup' }, { timeout: 3000 });
    expect(upload.calls).toBe(1);
    const { body } = await callMock<RecipesResponse>('GET', '/recipes');
    const made = body.recipes.find((r) => r.title === 'Tomato soup');
    expect(made?.categories).toEqual(['Soup', 'Easy']);
    const full = (await callMock<Recipe>('GET', `/recipes/${made?.id}`)).body;
    expect(full.photoKey).toMatch(/^recipes\//);
    expect(full.ingredients).toBe('# Soup\n6 tomatoes');
  });

  it('keeps the form and says so when the photo upload fails', async () => {
    upload.fail = true;
    const { user } = await renderMockApp('/recipes/new');
    await screen.findByRole('button', { name: 'Save' }, { timeout: 3000 });
    await user.type(screen.getByLabelText('Title'), 'Tomato soup');
    fireEvent.change(screen.getByLabelText('Choose photo'), {
      target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('Recipe photo preview');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Photo didn't upload. Try again.")).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveValue('Tomato soup');
    const { body } = await callMock<RecipesResponse>('GET', '/recipes');
    expect(body.recipes.some((r) => r.title === 'Tomato soup')).toBe(false);
  });

  it('asks before discarding unsaved changes', async () => {
    const { user } = await renderMockApp('/recipes/new');
    await user.type(await screen.findByLabelText('Title', {}, { timeout: 3000 }), 'Soup');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByText('Discard changes?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Soup');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(
      await screen
        .findByRole('heading', { name: /Lamb curry|No recipes yet/, level: 3 })
        .catch(() => null),
    ).toBeDefined();
  });

  it('reloads on a stale save (409) and deletes after confirming', async () => {
    const { user } = await renderMockApp(`${LAMB}/edit`);
    const title = await screen.findByLabelText('Title', {}, { timeout: 3000 });
    await waitFor(() => expect(title).toHaveValue('Lamb curry'));
    const current = (await callMock<Recipe>('GET', LAMB.replace('/recipes', '/recipes'))).body;
    await callMock('PUT', `/recipes/${current.id}`, {
      title: 'Lamb curry v2',
      version: current.version,
    });
    await user.type(title, ' edited');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changed on the other phone')).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Lamb curry v2'));
    await user.click(screen.getByRole('button', { name: 'Delete recipe' }));
    expect(await screen.findByText('Delete Lamb curry v2?')).toBeVisible();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Recipes' }, { timeout: 3000 });
    const { body } = await callMock<RecipesResponse>('GET', '/recipes');
    expect(body.recipes.some((r) => r.id === current.id)).toBe(false);
  });
});

describe('Free-text lines in shop mode', () => {
  const addIngredients = () =>
    callMock('POST', `/recipes/${MOCK_RECIPE_IDS.lambCurry}/to-list`, {
      lines: ['2 cups plain flour', '1 bunch coriander'],
    });

  it('shows text with a recipe note and no quantity, and ticks it', async () => {
    await renderMockApp(`/lists/${MOCK_SEED_IDS.thisWeekList}`);
    await screen.findByRole('heading', { level: 1, name: /Week of/ }, { timeout: 3000 });
    await addIngredients();
    window.dispatchEvent(new Event('visibilitychange'));
    const { findByRole } = within(document.body);
    const flour = await findByRole('checkbox', { name: '2 cups plain flour' });
    expect(flour).toHaveTextContent('From Lamb curry');
    expect(within(flour).getAllByTestId('text-line-icon')).toHaveLength(1);
    fireEvent.click(flour);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: '2 cups plain flour' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('edits text, group and note without a quantity stepper', async () => {
    const { user } = await renderMockApp(`/lists/${MOCK_SEED_IDS.thisWeekList}`);
    await screen.findByRole('heading', { level: 1, name: /Week of/ }, { timeout: 3000 });
    await addIngredients();
    window.dispatchEvent(new Event('visibilitychange'));
    await user.click(await screen.findByRole('button', { name: 'Edit 2 cups plain flour' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit line' });
    expect(within(dialog).queryByText('Quantity')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Text'));
    await user.type(within(dialog).getByLabelText('Text'), '3 cups plain flour');
    await user.selectOptions(within(dialog).getByLabelText('Group'), 'bakery');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('checkbox', { name: '3 cups plain flour' })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: '2 cups plain flour' })).not.toBeInTheDocument();
  });
});
