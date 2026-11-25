// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { addDays, storeToday, type ListDetail } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { MOCK_RECIPE_IDS } from '../api/mock-stage5';
import { resetTickQueue } from '../offline/tickQueue';
import { callMock, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

beforeEach(() => {
  vi.stubGlobal('__mockApiDelay', null);
  localStorage.clear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetTickQueue();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

const mon = () => storeToday();
const day = (n: number) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${addDays(mon(), n)}T00:00:00Z`),
  );

async function openPlan(setup?: () => Promise<void>) {
  const app = await renderMockApp('/recipes');
  await setup?.();
  await app.user.click(await screen.findByRole('button', { name: 'Plan' }));
  await screen.findByRole('list', { name: 'Days' }, { timeout: 3000 });
  return app;
}

describe('Plan view', () => {
  it('shows the seeded week with recipe and text entries, and remembers the view', async () => {
    await openPlan();
    const monday = screen.getByRole('listitem', { name: new RegExp(`^${day(0)}`) });
    expect(await within(monday).findByText('Lamb curry', {}, { timeout: 3000 })).toBeVisible();
    expect(within(monday).getByText('2 hr 15 min', { exact: false })).toBeVisible();
    const tuesday = screen.getByRole('listitem', { name: new RegExp(`^${day(1)}`) });
    expect(within(tuesday).getByText('Leftovers')).toBeVisible();
    // Empty meals collapse to "+ Add" rows.
    expect(
      within(tuesday).getByRole('button', { name: `Add breakfast on ${day(1)}` }),
    ).toBeVisible();
    expect(localStorage.getItem('trolley.recipes.view')).toBe('plan');
  });

  it('opens straight on Plan when that was the last view', async () => {
    localStorage.setItem('trolley.recipes.view', 'plan');
    await renderMockApp('/recipes');
    expect(await screen.findByRole('list', { name: 'Days' }, { timeout: 3000 })).toBeVisible();
  });

  it('moves by 7 days and jumps back to today', async () => {
    const { user } = await openPlan();
    await user.click(screen.getByRole('button', { name: 'Next 7 days' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Today' })).toBeVisible());
    expect(screen.queryByRole('button', { name: /^Lamb curry.*Actions/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(
      await screen.findByRole('button', { name: /^Lamb curry.*Actions/ }, { timeout: 3000 }),
    ).toBeVisible();
  });

  it('adds free text with a note to a day', async () => {
    const { user } = await openPlan();
    await user.click(await screen.findByRole('button', { name: `Add lunch on ${day(3)}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Something else' }));
    await user.type(within(dialog).getByLabelText('What'), 'Soup');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'From the freezer');
    await user.click(within(dialog).getByRole('button', { name: 'Add to plan' }));
    const thursday = await screen.findByRole('listitem', { name: new RegExp(`^${day(3)}`) });
    expect(await within(thursday).findByText('Soup')).toBeVisible();
    expect(within(thursday).getByText('From the freezer')).toBeVisible();
  });

  it('adds a recipe from the searchable list, favourites first', async () => {
    const { user } = await openPlan();
    await user.click(await screen.findByRole('button', { name: `Add dinner on ${day(3)}` }));
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole(
      'radiogroup',
      { name: 'Recipes' },
      { timeout: 3000 },
    );
    const names = within(list)
      .getAllByRole('radio')
      .map((r) => r.textContent ?? '');
    expect(names[0]).toMatch(/^Lamb curry/); // the seeded favourite
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search recipes' }), 'pancake');
    await user.click(await within(dialog).findByRole('radio', { name: /pancake/i }));
    await user.click(within(dialog).getByRole('button', { name: 'Add to plan' }));
    const thursday = await screen.findByRole('listitem', { name: new RegExp(`^${day(3)}`) });
    expect(await within(thursday).findByText(/pancake/i, {}, { timeout: 3000 })).toBeVisible();
  });

  it('moves an entry to another day and meal, then deletes with Undo', async () => {
    const { user } = await openPlan();
    await user.click(await screen.findByRole('button', { name: /^Eat out.*Actions/ }));
    let dialog = await screen.findByRole('dialog');
    const target = addDays(mon(), 5);
    const date = within(dialog).getByLabelText('Day');
    await user.clear(date);
    await user.type(date, target);
    await user.click(within(dialog).getByRole('radio', { name: 'Lunch' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    const saturday = await screen.findByRole('listitem', { name: new RegExp(`^${day(5)}`) });
    expect(await within(saturday).findByText('Eat out')).toBeVisible();

    await user.click(within(saturday).getByRole('button', { name: /^Eat out.*Actions/ }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Eat out')).toBeNull());
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Eat out')).toBeVisible();
  });

  it('edits a free-text entry: text, note, meal and day', async () => {
    const { user } = await openPlan();
    await user.click(await screen.findByRole('button', { name: /^Eat out.*Actions/ }));
    const dialog = await screen.findByRole('dialog');
    const what = within(dialog).getByLabelText('What');
    await user.clear(what);
    await user.type(what, 'Takeaway');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Thai');
    const date = within(dialog).getByLabelText('Day');
    await user.clear(date);
    await user.type(date, addDays(mon(), 5));
    await user.click(within(dialog).getByRole('radio', { name: 'Lunch' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const saturday = await screen.findByRole('listitem', { name: new RegExp(`^${day(5)}`) });
    expect(await within(saturday).findByText('Takeaway')).toBeVisible();
    expect(within(saturday).getByText('Thai')).toBeVisible();
    expect(screen.queryByText('Eat out')).toBeNull();
  });

  it('shows "Recipe deleted" when the recipe is gone', async () => {
    await openPlan(async () => {
      await callMock('DELETE', `/recipes/${MOCK_RECIPE_IDS.greekSalad}`);
    });
    expect(await screen.findByText('Recipe deleted', {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Lamb curry.*Actions/ })).toBeVisible();
  });

  it('adds a recipe to the plan from its detail page', async () => {
    const app = await renderMockApp(`/recipes/${MOCK_RECIPE_IDS.pancakes}`);
    await app.user.click(
      await screen.findByRole('button', { name: 'Add to plan' }, { timeout: 3000 }),
    );
    const dialog = await screen.findByRole('dialog');
    await app.user.click(within(dialog).getByRole('radio', { name: 'Lunch' }));
    await app.user.click(within(dialog).getByRole('button', { name: 'Add to plan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const week = await callMock<{ entries: Array<{ recipeId?: string; meal: string | null }> }>(
      'GET',
      `/plan?from=${storeToday()}&to=${storeToday()}`,
    );
    expect(week.body.entries).toContainEqual(
      expect.objectContaining({ recipeId: MOCK_RECIPE_IDS.pancakes, meal: 'lunch' }),
    );
  });
});

describe('Add ingredients for these 7 days', () => {
  it('reviews every recipe in the week and adds to the list with one Undo', async () => {
    const { user } = await openPlan(async () => {
      const r = await callMock<{ id: string }>('POST', '/recipes', {
        title: 'Salty dish',
        ingredients: '1 tsp salt\n2 carrots',
      });
      await callMock('POST', '/plan', { date: mon(), kind: 'recipe', recipeId: r.body.id });
    });
    await user.click(
      await screen.findByRole('button', { name: /Add ingredients for these 7 days/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('radio', { name: /Week of/ });
    await waitFor(
      () => expect(within(dialog).queryByText(/Finding ALDI products|Loading recipes/)).toBeNull(),
      { timeout: 4000 },
    );
    expect(within(dialog).getByRole('region', { name: 'Lamb curry' })).toBeVisible();
    expect(within(dialog).getByRole('region', { name: 'Greek salad' })).toBeVisible();
    expect(within(dialog).getByRole('region', { name: 'Salty dish' })).toBeVisible();
    // Pantry rows start unticked.
    const salt = within(dialog).queryAllByRole('checkbox', { name: /salt/i, checked: false });
    expect(salt.length).toBeGreaterThan(0);

    // Per-row product switcher: keep a matched row as text.
    const change = within(dialog).getAllByRole('button', {
      name: /^Change product for/,
    })[0] as HTMLElement;
    await user.click(change);
    await user.click(within(dialog).getByRole('radio', { name: 'Keep as text' }));
    expect(within(dialog).queryByRole('radiogroup', { name: /^Product for/ })).toBeNull();

    const before = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`)).body;
    // Some rows (salt) start unticked, so this reads "Select all": go to all, then none.
    await user.click(within(dialog).getByRole('button', { name: 'Select all' }));
    await user.click(within(dialog).getByRole('button', { name: 'Select none' }));
    await user.click(within(dialog).getAllByRole('checkbox')[0] as HTMLElement);
    await user.click(within(dialog).getByRole('button', { name: /^Add 1 to/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`)).body;
    expect(after.items.length).toBe(before.items.length + 1);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const undone = (await callMock<ListDetail>('GET', `/lists/${MOCK_SEED_IDS.thisWeekList}`))
        .body;
      expect(undone.items.length).toBe(before.items.length);
    });
  });

  it('is offered per day only when that day has a recipe', async () => {
    await openPlan();
    await screen.findByRole('button', { name: /^Lamb curry.*Actions/ }, { timeout: 3000 });
    expect(screen.getByRole('button', { name: `Add ingredients for ${day(0)}` })).toBeVisible();
    expect(screen.queryByRole('button', { name: `Add ingredients for ${day(1)}` })).toBeNull();
  });
});
