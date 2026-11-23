// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_GROUPS } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { failNext, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const WEEK = `/lists/${MOCK_SEED_IDS.thisWeekList}`;
const ARCHIVED = `/lists/${MOCK_SEED_IDS.archivedLists[0]}`;

const log = () => (globalThis as { __mockApiLog?: string[] }).__mockApiLog ?? [];
beforeEach(() => {
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog = [];
});
afterEach(async () => {
  vi.useRealTimers();
  // Unmounting flushes pending deletes; let those mock calls land before the next test resets state.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 300));
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog = undefined;
});

async function shop(path = WEEK, opts: { fakeTimers?: boolean } = {}) {
  // Fake timers must be installed before the app mounts so React Query's poll timer is faked too.
  if (opts.fakeTimers) vi.useFakeTimers({ shouldAdvanceTime: true });
  const app = await renderMockApp(path);
  await screen.findByRole('heading', { level: 1, name: /Week of/ }, { timeout: 3000 });
  return app;
}

const row = (name: RegExp | string) => screen.getByRole('checkbox', { name });
const rowNames = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label')?.split(',')[0]);
const group = (name: (typeof DEFAULT_GROUPS)[number]['name']) =>
  screen.getByRole('region', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}`) });
const pill = () => screen.getByText(/^\d+ of \d+ (ticked|bought)$/);

describe('shop mode: layout and grouping', () => {
  it('groups by the household aisle order, hides empty groups and shows ticked/total per group', async () => {
    await shop();
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.replace(/\d+\/\d+.*$/, '').trim() ?? '');
    const order: string[] = DEFAULT_GROUPS.map((g) => g.name);
    const idx = names.map((n) => order.indexOf(n));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).not.toContain('Liquor');
    expect(
      within(group('Fruit & Veg')).getByRole('button', { name: /Fruit & Veg/ }),
    ).toHaveAccessibleName(/1 of 4 ticked/);
  });

  it('sorts unticked by name then ticked, shows pack size, notes and bold quantity', async () => {
    await shop();
    const fruit = group('Fruit & Veg');
    expect(rowNames(fruit)).toEqual([
      'Garlic per kg',
      'Gourmet Tomatoes per kg',
      'Granny Smith Apples per kg',
      'Cavendish Bananas per kg',
    ]);
    expect(row(/Gourmet Tomatoes per kg, 0.5 kg/)).toHaveTextContent('Ripe ones for Tuesday');
    expect(
      within(fruit)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'false', 'true']);
    expect(pill()).toHaveTextContent('6 of 21 ticked');
    expect(screen.getByRole('progressbar', { name: 'Items ticked' })).toHaveAttribute(
      'aria-valuenow',
      '6',
    );
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
  });

  it('every row has a tick target and a separate Edit button', async () => {
    await shop();
    expect(screen.getAllByRole('checkbox')).toHaveLength(21);
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(21);
  });

  it('collapses a group from its header and keeps the count', async () => {
    const { user } = await shop();
    const header = within(group('Fruit & Veg')).getByRole('button', { name: /Fruit & Veg/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(within(group('Fruit & Veg')).queryAllByRole('checkbox')).toHaveLength(0);
    expect(header).toHaveTextContent('1/4');
  });
});

describe('shop mode: tick and untick', () => {
  it('ticks at once, updates the count, then sinks the row to the bottom of its group', async () => {
    const { user } = await shop();
    await user.click(row(/Granny Smith Apples/));
    expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    expect(pill()).toHaveTextContent('7 of 21 ticked');
    expect(row(/Granny Smith Apples/)).toHaveTextContent('Granny Smith Apples per kg');
    // Greyed with a strike-through (not colour alone).
    expect(within(row(/Granny Smith Apples/)).getByText('Granny Smith Apples per kg')).toHaveClass(
      'line-through',
      'text-muted',
    );
    // Stays put for 500 ms, then moves below the unticked rows.
    expect(rowNames(group('Fruit & Veg'))[2]).toBe('Granny Smith Apples per kg');
    await waitFor(() =>
      expect(rowNames(group('Fruit & Veg'))).toEqual([
        'Garlic per kg',
        'Gourmet Tomatoes per kg',
        'Cavendish Bananas per kg',
        'Granny Smith Apples per kg',
      ]),
    );
    expect(log().some((c) => c.startsWith('PATCH /api/lists/') && c.includes('/items/'))).toBe(
      true,
    );
  });

  it('unticking returns the row to its alphabetical place', async () => {
    const { user } = await shop();
    await user.click(row(/Cavendish Bananas/));
    expect(row(/Cavendish Bananas/)).toHaveAttribute('aria-checked', 'false');
    expect(pill()).toHaveTextContent('5 of 21 ticked');
    await waitFor(() => expect(rowNames(group('Fruit & Veg'))[0]).toBe('Cavendish Bananas per kg'));
  });

  it('rolls a failed tick back and offers Try again', async () => {
    const { user } = await shop();
    failNext('PATCH /api/lists/', 500);
    await user.click(row(/Granny Smith Apples/));
    expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await waitFor(() =>
      expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'false'),
    );
    expect(pill()).toHaveTextContent('6 of 21 ticked');
    expect(await screen.findByText("Couldn't save. Check your connection.")).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(pill()).toHaveTextContent('7 of 21 ticked'));
  });
});

describe('shop mode: auto-archive with Undo', () => {
  it('archives on the last tick, shows the banner and toast, and Undo reopens it', async () => {
    const { user } = await shop();
    while (screen.queryAllByRole('checkbox', { checked: false }).length > 0) {
      const first = screen.getAllByRole('checkbox', { checked: false })[0] as HTMLElement;
      await user.click(first);
    }
    expect(await screen.findByText('Shop complete! This list is archived.')).toBeVisible();
    expect(await screen.findByText('Shop complete - list archived')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Add items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'List options' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Add items' })).toBeVisible());
    expect(screen.queryByText('Shop complete! This list is archived.')).not.toBeInTheDocument();
    expect(log().some((c) => c.startsWith('POST /api/lists/') && c.endsWith('/reopen'))).toBe(true);
    // All ticked, still active: the count pill reads 21 of 21 until another tick completes it.
    expect(pill()).toHaveTextContent('21 of 21 ticked');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(21);
  }, 30000);

  it('shows the archived state when the other phone finishes the list', async () => {
    await shop(WEEK, { fakeTimers: true });
    // The loser of a race sees status archived on its next poll.
    const { mockFetch } = await import('../api/mock');
    const auth = (await import('../test/authService')).authHolder.auth;
    const token = await auth?.getIdToken();
    await mockFetch(`/api/lists/${MOCK_SEED_IDS.thisWeekList}/finish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(await screen.findByText('This list was finished on another phone.')).toBeVisible();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('shop mode: swipe to delete', () => {
  const swipe = (li: HTMLElement, from: number, to: number) => {
    fireEvent.pointerDown(li, {
      clientX: from,
      clientY: 20,
      pointerId: 1,
      button: 0,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(li, {
      clientX: (from + to) / 2,
      clientY: 22,
      pointerId: 1,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(li, { clientX: to, clientY: 22, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(li, { clientX: to, clientY: 22, pointerId: 1, pointerType: 'touch' });
  };
  const rowOf = (name: RegExp) => row(name).closest('li') as HTMLElement;

  it('a long swipe removes the row with an Undo toast and sends DELETE only when it expires', async () => {
    await shop(WEEK, { fakeTimers: true });
    swipe(rowOf(/Garlic per kg/), 340, 60);
    expect(screen.queryByRole('checkbox', { name: /Garlic per kg/ })).not.toBeInTheDocument();
    expect(screen.getByText('Removed Garlic per kg')).toBeVisible();
    expect(pill()).toHaveTextContent('6 of 20 ticked');
    expect(log().some((c) => c.startsWith('DELETE'))).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5300);
    });
    await waitFor(() => expect(log().some((c) => c.startsWith('DELETE /api/lists/'))).toBe(true));
    expect(screen.queryByRole('checkbox', { name: /Garlic per kg/ })).not.toBeInTheDocument();
  });

  it('Undo brings the row back with its state and cancels the DELETE', async () => {
    const { user } = await shop(WEEK, { fakeTimers: true });
    swipe(rowOf(/Cavendish Bananas/), 340, 60);
    expect(screen.queryByRole('checkbox', { name: /Cavendish Bananas/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(row(/Cavendish Bananas per kg, 1.5 kg/)).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(log().some((c) => c.startsWith('DELETE'))).toBe(false);
    void user;
  });

  it('a short swipe rests open with a Delete button and does not tick', async () => {
    const { user } = await shop();
    swipe(rowOf(/Garlic per kg/), 340, 270);
    expect(row(/Garlic per kg/)).toHaveAttribute('aria-checked', 'false');
    const del = screen.getByRole('button', { name: 'Delete Garlic per kg' });
    await user.click(del);
    expect(screen.queryByRole('checkbox', { name: /Garlic per kg/ })).not.toBeInTheDocument();
    expect(screen.getByText('Removed Garlic per kg')).toBeVisible();
  });

  it('a tiny drag snaps back', async () => {
    await shop();
    swipe(rowOf(/Garlic per kg/), 340, 320);
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    expect(row(/Garlic per kg/)).toBeInTheDocument();
  });

  it('leaving the screen sends the pending DELETE at once', async () => {
    const { user } = await shop();
    swipe(rowOf(/Garlic per kg/), 340, 60);
    await user.click(screen.getByRole('link', { name: 'Back to lists' }));
    await waitFor(() => expect(log().some((c) => c.startsWith('DELETE /api/lists/'))).toBe(true));
  });
});

describe('shop mode: edit sheet', () => {
  it('opens the quantity modal in edit mode, prefilled, with Save disabled until changed', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Gourmet Tomatoes per kg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gourmet Tomatoes per kg' });
    expect(within(dialog).getByRole('textbox', { name: /Quantity in kg/ })).toHaveValue('0.5');
    expect(within(dialog).getByLabelText('Note (optional)')).toHaveValue('Ripe ones for Tuesday');
    expect(within(dialog).queryByRole('button', { name: /^Adding to/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Remove from list' })).toBeVisible();
  });

  it('saves a new quantity and note, in place, with no toast', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Crunchy ones');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(row(/Granny Smith Apples per kg, 2 kg/)).toHaveTextContent('Crunchy ones');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('a unit change re-keys the row and Remember saves the household override', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'g' }));
    expect(
      within(dialog).getByRole('checkbox', { name: /Remember g for this product/ }),
    ).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(row(/Granny Smith Apples per kg, 1000 g/)).toBeInTheDocument();
    await waitFor(() =>
      expect(log().some((c) => c.startsWith('PUT /api/settings/unit-overrides/'))).toBe(true),
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(21);
  });

  it('a stale edit (409) closes the sheet, says so and shows the latest', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    failNext('PATCH /api/lists/', 409);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changed on another phone - showing latest')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row(/Granny Smith Apples per kg, 1 kg/)).toBeInTheDocument();
  });

  it('a failed save keeps the sheet open with the error banner and rolls the row back', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    failNext('PATCH /api/lists/', 500);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't save that change. Please try again.",
    );
    expect(row(/Granny Smith Apples per kg, 1 kg/)).toBeInTheDocument();
  });

  it('Remove from list removes the row with an Undo toast', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'Edit Garlic per kg' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from list' }));
    expect(screen.queryByRole('checkbox', { name: /Garlic per kg/ })).not.toBeInTheDocument();
    expect(screen.getByText('Removed Garlic per kg')).toBeVisible();
  });
});

describe('shop mode: list options', () => {
  it('renames the list', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Rename list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename list' });
    const input = within(dialog).getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Big shop');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Big shop' })).toBeVisible();
    expect(log().some((c) => c.startsWith('PATCH /api/lists/'))).toBe(true);
  });

  it('validates the rename', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Rename list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename list' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a name for this list.')).toBeVisible();
  });

  it('shows "This is this week\'s list" instead of Set as this week for the flagged list', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("This is this week's list")).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Set as this week' }),
    ).not.toBeInTheDocument();
  });

  it('Finish shop confirms with the unticked count, archives and offers Undo', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Finish shop' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Finish this shop?' });
    expect(confirm).toHaveTextContent("15 items aren't ticked. They'll be left off your history.");
    await user.click(within(confirm).getByRole('button', { name: 'Finish and archive' }));
    expect(await screen.findByText('Shop complete! This list is archived.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(pill()).toHaveTextContent('6 of 21 bought');
  });

  it('Delete list confirms and returns to Lists', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Delete list' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveAccessibleName(/^Delete Week of/);
    expect(confirm).toHaveTextContent("This also deletes its 21 items. This can't be undone.");
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Delete list' }));
    expect(await screen.findByText('No lists yet')).toBeVisible();
    expect(screen.getByText(/^Deleted Week of/)).toBeVisible();
  });

  it('Add from template picks a template, reviews its items all ticked, then bulk adds with Undo', async () => {
    const { user } = await shop();
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Add from template' }));
    const picker = await screen.findByRole('dialog', { name: 'Add from template' });
    await user.click(await within(picker).findByRole('button', { name: /Tacos/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Tacos' });
    const boxes = await within(dialog).findAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    boxes.forEach((b) => expect(b).toHaveAttribute('aria-checked', 'true'));
    await user.click(within(dialog).getByRole('button', { name: 'Select none' }));
    expect(within(dialog).getAllByText('0 of 5 selected').length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole('button', { name: 'Select all' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 5 items' }));
    expect(await screen.findByText(/^Added 5 items/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
});

describe('shop mode: sync and states', () => {
  it('polls every 10 s and shows ticks made on the other phone', async () => {
    await shop(WEEK, { fakeTimers: true });
    const { mockFetch } = await import('../api/mock');
    const auth = (await import('../test/authService')).authHolder.auth;
    const token = await auth?.getIdToken();
    const detail = await (
      await mockFetch(`/api/lists/${MOCK_SEED_IDS.thisWeekList}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();
    const apples = detail.items.find((i: { product: { name: string } }) =>
      i.product.name.includes('Granny Smith'),
    );
    await mockFetch(
      `/api/lists/${MOCK_SEED_IDS.thisWeekList}/items/${encodeURIComponent(apples.id)}`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ticked: true }),
      },
    );
    expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'false');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    await waitFor(() => expect(row(/Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true'));
    expect(pill()).toHaveTextContent('7 of 21 ticked');
  });

  it('shows the offline banner', async () => {
    await shop();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(
        await screen.findByText("You're offline - ticks won't save until you're back"),
      ).toBeVisible();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      // React Query's online manager is global: tell it we are back.
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('shows "That list isn\'t here any more." for a missing list', async () => {
    await renderMockApp('/lists/00000000-0000-4000-8000-00000000ffff');
    expect(await screen.findByText("That list isn't here any more.")).toBeVisible();
    for (const link of screen.getAllByRole('link', { name: 'Back to lists' })) {
      expect(link).toHaveAttribute('href', '/');
    }
  });

  it('shows an error with Try again when the list fails to load', async () => {
    await renderMockApp(WEEK, { fail: { match: 'GET /api/lists/', times: 2 } });
    expect(await screen.findByText("Couldn't load this list", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

describe('archived list (read-only)', () => {
  it('has no tick, edit, add or delete controls and says what was not bought', async () => {
    await renderMockApp(ARCHIVED);
    expect(
      await screen.findByText('Archived and read-only. Nothing here can be changed.'),
    ).toBeVisible();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'List options' })).not.toBeInTheDocument();
    expect(screen.getByText('11 of 12 bought')).toBeInTheDocument();
    expect(screen.getAllByText(/^Not bought/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Finished /)).toBeVisible();
  });

  it('lists what was bought first within each group', async () => {
    await renderMockApp(ARCHIVED);
    await screen.findByText('Archived and read-only. Nothing here can be changed.');
    const ul = screen.getAllByText(/^Not bought/)[0]?.closest('ul') as HTMLElement;
    const items = within(ul).getAllByRole('listitem');
    expect(items[items.length - 1]).toHaveTextContent('Not bought');
    for (const bought of items.slice(0, -1)) expect(bought).toHaveTextContent(/^.*Bought\./);
  });
});
