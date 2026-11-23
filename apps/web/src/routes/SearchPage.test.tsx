// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import type {
  ListItem,
  ListSummary,
  ProductSearchResponse,
  ProductSummary,
  TemplateSummary,
} from '@trolley/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  createCustomProduct: vi.fn(),
  getLists: vi.fn(),
  getTemplates: vi.fn(),
  addThisWeekItem: vi.fn(),
  addListItem: vi.fn(),
  addTemplateItem: vi.fn(),
  deleteListItem: vi.fn(),
  updateListItem: vi.fn(),
  deleteTemplateItem: vi.fn(),
  saveUnitOverride: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { DEFAULT_GROUPS } = await import('@trolley/core');
  return {
    ...actual,
    getMe: vi
      .fn()
      .mockResolvedValue({ userId: 'u1', email: 'alex@example.com', householdId: 'h1' }),
    getGroups: vi.fn().mockResolvedValue({ groups: DEFAULT_GROUPS }),
    searchProducts: api.searchProducts,
    createCustomProduct: api.createCustomProduct,
    getLists: api.getLists,
    getTemplates: api.getTemplates,
    addThisWeekItem: api.addThisWeekItem,
    addListItem: api.addListItem,
    addTemplateItem: api.addTemplateItem,
    deleteListItem: api.deleteListItem,
    updateListItem: api.updateListItem,
    deleteTemplateItem: api.deleteTemplateItem,
    saveUnitOverride: api.saveUnitOverride,
  };
});

import { ApiError } from '../api';
import { clearListOverlay } from '../lists/data';
import { sessionTargets } from '../search/target';
import { makeAuth, renderApp } from '../test/render';

const listSummary = (over: Partial<ListSummary> = {}): ListSummary => ({
  id: 'list-week',
  name: 'Week of 23 Nov',
  status: 'active',
  thisWeek: true,
  itemCount: 12,
  tickedCount: 3,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  completedAt: null,
  finishedBy: null,
  version: 1,
  ...over,
});
const templateSummary = (over: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: 'tpl-tacos',
  name: 'Tacos',
  type: 'meal',
  itemCount: 5,
  preview: [],
  version: 1,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  ...over,
});
const listItem = (over: Partial<ListItem> = {}): ListItem => ({
  id: '100001~kg',
  listId: 'list-week',
  product: {
    productId: '100001',
    name: 'Potatoes',
    brand: null,
    imageUrl: null,
    packSize: 'per kg',
    groupId: 'fruit-veg',
    unitType: 'kg',
  },
  qty: 1.5,
  unit: 'kg',
  note: null,
  ticked: false,
  tickedAt: null,
  version: 1,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  updatedBy: 'u1',
  ...over,
});

const product = (n: number, over: Partial<ProductSummary> = {}): ProductSummary => ({
  sku: String(100000 + n),
  name: `Milk number ${n}`,
  brand: 'Riverina Fresh',
  imageUrl: null,
  price: 219,
  unitPrice: null,
  packSize: '2 L',
  unitType: 'pack',
  groupId: 'dairy-eggs',
  custom: false,
  ...over,
});

const page = (items: ProductSummary[], total: number, nextCursor: string | null = null) =>
  ({ items, total, nextCursor }) satisfies ProductSearchResponse;

// IntersectionObserver is not in jsdom: capture instances so tests can "scroll".
class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {
    FakeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((o) => o !== this);
  }
  fire() {
    this.cb([{ isIntersecting: true }]);
  }
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

async function searchTab(path = '/search') {
  const auth = makeAuth();
  await auth.signIn('alex@example.com', 'Password1');
  const app = renderApp(path, { auth });
  await screen.findByRole('searchbox', { name: 'Search products' });
  return app;
}

const callsFor = (q: string) =>
  api.searchProducts.mock.calls.filter(([params]) => (params as { q: string }).q === q);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getLists.mockResolvedValue({ lists: [listSummary()] });
  api.getTemplates.mockResolvedValue({
    templates: [
      templateSummary(),
      templateSummary({ id: 'tpl-basics', name: 'Weekly basics', type: 'weekly', itemCount: 10 }),
    ],
  });
  api.addThisWeekItem.mockResolvedValue({
    item: listItem(),
    list: listSummary(),
    merged: false,
    addedQty: 1.5,
    listCreated: false,
  });
  api.addListItem.mockResolvedValue({
    item: listItem(),
    list: listSummary(),
    merged: false,
    addedQty: 1.5,
  });
  api.addTemplateItem.mockResolvedValue({
    template: { ...templateSummary(), items: [] },
    item: listItem(),
    merged: false,
  });
  api.deleteListItem.mockResolvedValue({ list: listSummary() });
  api.updateListItem.mockResolvedValue({ item: listItem(), list: listSummary(), archived: false });
  api.saveUnitOverride.mockResolvedValue({ override: null });
  sessionTargets.reset();
  clearListOverlay();
  FakeObserver.all = [];
});

describe('Search tab: initial state and typing', () => {
  it('prompts to search, offers a custom item and makes no request', async () => {
    await searchTab();
    expect(screen.getByRole('heading', { name: 'Find your ALDI items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a custom item' })).toBeInTheDocument();
    expect(api.searchProducts).not.toHaveBeenCalled();
  });

  it('shows the category chips as a radiogroup with All selected', async () => {
    await searchTab();
    const group = screen.getByRole('radiogroup', { name: 'Filter by category' });
    const radios = within(group).getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName('All');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios).toHaveLength(17);
    expect(within(group).getByRole('radio', { name: 'Fruit & Veg' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('debounces: one request per pause, none for fewer than 2 characters', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab();
    const field = screen.getByRole('searchbox', { name: 'Search products' });

    await user.type(field, 'm');
    await new Promise((r) => setTimeout(r, 350));
    expect(api.searchProducts).not.toHaveBeenCalled();

    await user.type(field, 'ilk');
    expect(api.searchProducts).not.toHaveBeenCalled(); // inside the 250 ms window
    await screen.findByText('Milk number 1');
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
    expect(api.searchProducts.mock.calls[0]?.[0]).toMatchObject({ q: 'milk', limit: 24 });
  });

  it('trims whitespace and the keyboard Search key runs the query at once', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab();
    const field = screen.getByRole('searchbox', { name: 'Search products' });
    await user.type(field, '  milk  {Enter}');
    expect(field).not.toHaveFocus();
    await screen.findByText('Milk number 1');
    expect(callsFor('milk')).toHaveLength(1);
  });

  it('shows the result count and cards with price, pack size and buttons', async () => {
    api.searchProducts.mockResolvedValue(page([product(1), product(2)], 2));
    const { user } = await searchTab();
    await user.type(screen.getByRole('searchbox'), 'milk');
    await screen.findByText('Milk number 1');
    expect(screen.getByText('2 results')).toBeInTheDocument();
    const card = screen.getByText('Milk number 1').closest('li') as HTMLElement;
    expect(within(card).getByText('Riverina Fresh')).toBeInTheDocument();
    expect(within(card).getByText('$2.19')).toBeInTheDocument();
    expect(within(card).getByText('2 L')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Add Milk number 1 to list' }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Add Milk number 1 to a template' }),
    ).toBeInTheDocument();
  });

  it('says "1 result" in the singular', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab();
    await user.type(screen.getByRole('searchbox'), 'milk');
    expect(await screen.findByText('1 result')).toBeInTheDocument();
  });

  it('clear empties the field, keeps focus and returns to the initial state', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab();
    const field = screen.getByRole('searchbox');
    await user.type(field, 'milk');
    await screen.findByText('Milk number 1');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(
      await screen.findByRole('heading', { name: 'Find your ALDI items' }),
    ).toBeInTheDocument();
  });

  it('restores the search from the URL', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    await searchTab('/search?q=milk');
    expect(screen.getByRole('searchbox')).toHaveValue('milk');
    await screen.findByText('Milk number 1');
    expect(callsFor('milk')).toHaveLength(1);
  });
});

describe('Search tab: categories', () => {
  it('browses a category with an empty query and shows "Group, N products"', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 86));
    const { user } = await searchTab();
    await user.click(screen.getByRole('radio', { name: 'Dairy' }));
    await screen.findByText('Milk number 1');
    expect(api.searchProducts.mock.calls[0]?.[0]).toMatchObject({
      q: '',
      category: 'dairy-eggs',
    });
    expect(screen.getByText('Dairy, 86 products')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dairy' })).toHaveAttribute('aria-checked', 'true');
  });

  it('tapping the selected chip again returns to All', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab('/search?cat=dairy-eggs');
    await screen.findByText('Milk number 1');
    await user.click(screen.getByRole('radio', { name: 'Dairy' }));
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(
      await screen.findByRole('heading', { name: 'Find your ALDI items' }),
    ).toBeInTheDocument();
  });

  it('narrows a query by category', async () => {
    api.searchProducts.mockResolvedValue(page([product(1)], 1));
    const { user } = await searchTab('/search?q=milk');
    await screen.findByText('Milk number 1');
    await user.click(screen.getByRole('radio', { name: 'Dairy' }));
    await waitFor(() =>
      expect(api.searchProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'milk', category: 'dairy-eggs' }),
        expect.anything(),
      ),
    );
  });
});

describe('Search tab: paging', () => {
  it('loads the next page when the sentinel nears the viewport and marks the end', async () => {
    api.searchProducts
      .mockResolvedValueOnce(page([product(1), product(2)], 3, 'cursor-2'))
      .mockResolvedValueOnce(page([product(3)], 3));
    await searchTab('/search?q=milk');
    await screen.findByText('Milk number 2');
    expect(screen.queryByText("That's everything for 'milk'.")).not.toBeInTheDocument();

    await waitFor(() => expect(FakeObserver.all.length).toBeGreaterThan(0));
    FakeObserver.all.at(-1)?.fire();
    await screen.findByText('Milk number 3');
    expect(api.searchProducts.mock.calls[1]?.[0]).toMatchObject({ q: 'milk', cursor: 'cursor-2' });
    // Earlier cards stay, in order, with no duplicates.
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Milk number 1', 'Milk number 2', 'Milk number 3']);
    expect(screen.getByText("That's everything for 'milk'.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Can't find it? Add a custom item" })).toBeVisible();
  });

  it('keeps the grid and offers Try again when loading more fails', async () => {
    api.searchProducts
      .mockResolvedValueOnce(page([product(1)], 2, 'cursor-2'))
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION', 'Invalid cursor', {}))
      .mockResolvedValueOnce(page([product(2)], 2));
    const { user } = await searchTab('/search?q=milk');
    await screen.findByText('Milk number 1');
    await waitFor(() => expect(FakeObserver.all.length).toBeGreaterThan(0));
    FakeObserver.all.at(-1)?.fire();
    expect(await screen.findByText("Couldn't load more.")).toBeInTheDocument();
    expect(screen.getByText('Milk number 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Milk number 2');
  });
});

describe('Search tab: no results and custom products', () => {
  it('shows the no-results state with a custom item button', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    await searchTab('/search?q=xyz');
    expect(
      await screen.findByRole('heading', { name: "No matches for 'xyz'" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Check the spelling, try a shorter word.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Add 'xyz' as a custom item" })).toBeInTheDocument();
  });

  it('mentions All categories only when a chip is on', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    await searchTab('/search?q=xyz&cat=bakery');
    expect(
      await screen.findByText('Check the spelling, try a shorter word, or pick "All" categories.'),
    ).toBeInTheDocument();
  });

  it('truncates a long query in the heading and button', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    await searchTab('/search?q=abcdefghijklmnopqrstuvwxyz0123');
    expect(
      await screen.findByRole('heading', { name: "No matches for 'abcdefghijklmnopqrstuvwx...'" }),
    ).toBeInTheDocument();
  });

  it('no results -> custom sheet -> creates -> quantity modal -> toast', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    api.createCustomProduct.mockImplementation(
      async (body: { name: string; unitType: string }) => ({
        sku: 'custom-123',
        name: body.name,
        brand: null,
        imageUrl: null,
        price: null,
        unitPrice: null,
        packSize: null,
        unitType: body.unitType,
        groupId: 'meat-seafood',
        custom: true,
      }),
    );
    const { user } = await searchTab('/search?q=lamb%20mince&cat=meat-seafood');
    await user.click(
      await screen.findByRole('button', { name: "Add 'lamb mince' as a custom item" }),
    );

    const sheet = await screen.findByRole('dialog', { name: 'Add a custom item' });
    // Prefilled from the query and the active chip; Meat & Seafood defaults to kg.
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Lamb mince');
    expect(within(sheet).getByLabelText('Group')).toHaveValue('meat-seafood');
    expect(within(sheet).getByRole('radio', { name: 'kg' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(sheet).getByText('Sold by weight, like loose potatoes.')).toBeInTheDocument();
    // Prefilled name: focus lands on the heading so the keyboard stays down.
    expect(within(sheet).getByRole('heading', { name: 'Add a custom item' })).toHaveFocus();

    await user.click(within(sheet).getByRole('button', { name: 'Save and choose quantity' }));
    expect(api.createCustomProduct.mock.calls[0]?.[0]).toEqual({
      name: 'Lamb mince',
      groupId: 'meat-seafood',
      unitType: 'kg',
    });

    const modal = await screen.findByRole('dialog', { name: 'Lamb mince' });
    expect(screen.queryByRole('dialog', { name: 'Add a custom item' })).not.toBeInTheDocument();
    expect(within(modal).getByText('Custom item')).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: '1.5 kg' }));
    await user.click(within(modal).getByRole('button', { name: /^Add to/ }));

    expect(await screen.findByText('Added 1.5 kg Lamb mince to Week of 23 Nov')).toBeVisible();
    expect(api.addThisWeekItem.mock.calls[0]?.[0]).toMatchObject({ qty: 1.5, unit: 'kg' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validates the name in the custom sheet', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    const { user } = await searchTab();
    await user.click(screen.getByRole('button', { name: 'Add a custom item' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a custom item' });
    const name = within(sheet).getByLabelText('Name');
    expect(name).toHaveFocus(); // empty name: focus the field
    await user.click(within(sheet).getByRole('button', { name: 'Save and choose quantity' }));
    expect(await within(sheet).findByText('Enter a name for this item.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(api.createCustomProduct).not.toHaveBeenCalled();

    await user.type(name, 'x'.repeat(81));
    await user.click(within(sheet).getByRole('button', { name: 'Save and choose quantity' }));
    expect(
      await within(sheet).findByText('Keep it to 80 characters or fewer.'),
    ).toBeInTheDocument();
  });

  it('shows a save error inline and keeps the values', async () => {
    api.searchProducts.mockResolvedValue(page([], 0));
    api.createCustomProduct.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', {}));
    const { user } = await searchTab('/search?q=bread');
    await user.click(await screen.findByRole('button', { name: "Add 'bread' as a custom item" }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a custom item' });
    await user.click(within(sheet).getByRole('radio', { name: 'pack' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save and choose quantity' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Couldn't save that item. Please try again.",
    );
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Bread');
    expect(within(sheet).getByRole('radio', { name: 'pack' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      within(sheet).getByRole('button', { name: 'Save and choose quantity' }),
    ).not.toBeDisabled();
  });

  it('offers "Use existing" for a duplicate custom name', async () => {
    const existing = product(9, { name: 'Lamb mince', custom: true, brand: null, unitType: 'kg' });
    api.searchProducts.mockImplementation(async ({ q }: { q: string }) =>
      q.toLowerCase().startsWith('lamb') ? page([existing], 1) : page([], 0),
    );
    const { user } = await searchTab();
    await user.click(screen.getByRole('button', { name: 'Add a custom item' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a custom item' });
    await user.type(within(sheet).getByLabelText('Name'), 'lamb mince');
    await user.click(await within(sheet).findByRole('button', { name: 'Use existing' }));
    expect(within(sheet).queryByText(/You already have a custom item/)).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Lamb mince' })).toBeInTheDocument();
    expect(api.createCustomProduct).not.toHaveBeenCalled();
  });

  it('shows the Custom badge on custom products', async () => {
    api.searchProducts.mockResolvedValue(
      page([product(1, { name: 'Lamb mince', custom: true, brand: null, price: null })], 1),
    );
    await searchTab('/search?q=lamb');
    const card = (await screen.findByText('Lamb mince')).closest('li') as HTMLElement;
    expect(within(card).getByText('Custom')).toBeInTheDocument();
  });
});

describe('Search tab: errors and loading', () => {
  it('shows an inline error and retries with Try again', async () => {
    api.searchProducts
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x', {}))
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x', {})) // the automatic retry
      .mockResolvedValueOnce(page([product(1)], 1));
    const { user } = await searchTab('/search?q=milk');
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("Couldn't load products");
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    // The search field stays usable.
    expect(screen.getByRole('searchbox')).toHaveValue('milk');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Milk number 1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the unreachable copy for network failures', async () => {
    api.searchProducts.mockRejectedValue(new TypeError('Failed to fetch'));
    await searchTab('/search?q=milk');
    expect(
      await screen.findByText("Can't reach Trolley right now.", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('does not retry client errors', async () => {
    api.searchProducts.mockRejectedValue(new ApiError(400, 'VALIDATION', 'bad', {}));
    await searchTab('/search?q=milk');
    await screen.findByRole('alert');
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
  });

  it('shows skeleton cards when the first page is slow', async () => {
    api.searchProducts.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(page([product(1)], 1)), 600)),
    );
    await searchTab('/search?q=milk');
    await waitFor(() => expect(document.querySelectorAll('[aria-busy="true"] li')).toHaveLength(6));
    expect(screen.getByText('Searching')).toBeInTheDocument();
    await screen.findByText('Milk number 1');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('Search tab: adding and toasts', () => {
  const potatoes = product(1, {
    name: 'Potatoes',
    unitType: 'kg',
    packSize: 'per kg',
    groupId: 'fruit-veg',
  });

  async function openPotatoes(path = '/search?q=potato') {
    api.searchProducts.mockResolvedValue(page([potatoes], 1));
    const app = await searchTab(path);
    const addButton = await screen.findByRole('button', { name: 'Add Potatoes to list' });
    await app.user.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Potatoes' });
    return { ...app, addButton, dialog };
  }

  it('Add defaults to this week: toast with Undo, Added state, focus back on the button', async () => {
    const { user, dialog, addButton } = await openPotatoes();
    expect(
      await within(dialog).findByRole('button', { name: 'Add to Week of 23 Nov' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '1.5 kg' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add to Week of 23 Nov' }));

    expect(await screen.findByText('Added 1.5 kg Potatoes to Week of 23 Nov')).toBeVisible();
    expect(api.addThisWeekItem).toHaveBeenCalledWith({
      productId: '100001',
      qty: 1.5,
      unit: 'kg',
      note: null,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
    const button = screen.getByRole('button', { name: 'Add Potatoes to list' });
    expect(button).toHaveFocus();
    expect(button).toHaveTextContent('Added');
    expect(addButton).toBeDefined();
  });

  it('Undo of a new row deletes it; Undo of a merge takes the added quantity off', async () => {
    const first = await openPotatoes();
    await first.user.click(
      await within(first.dialog).findByRole('button', { name: 'Add to Week of 23 Nov' }),
    );
    await first.user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.deleteListItem).toHaveBeenCalledWith('list-week', '100001~kg'));

    api.addThisWeekItem.mockResolvedValue({
      item: listItem({ qty: 3, version: 4 }),
      list: listSummary(),
      merged: true,
      addedQty: 1,
      listCreated: false,
    });
    api.addListItem.mockResolvedValue({
      item: listItem({ qty: 3, version: 4 }),
      list: listSummary(),
      merged: true,
      addedQty: 1,
    });
    await first.user.click(await screen.findByRole('button', { name: 'Add Potatoes to list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potatoes' });
    await first.user.click(await within(dialog).findByRole('button', { name: /^Add to Week/ }));
    expect(await screen.findByText('Updated Potatoes: now 3 kg in Week of 23 Nov')).toBeVisible();
    await first.user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(api.updateListItem).toHaveBeenCalledWith('list-week', '100001~kg', {
        qty: 2,
        version: 4,
      }),
    );
  });

  it('creating the this-week list says so in the toast', async () => {
    api.getLists.mockResolvedValue({ lists: [] });
    api.addThisWeekItem.mockResolvedValue({
      item: listItem(),
      list: listSummary(),
      merged: false,
      addedQty: 1,
      listCreated: true,
    });
    const { user, dialog } = await openPotatoes();
    expect(
      await within(dialog).findByRole('button', {
        name: 'Adding to New list: Week of 23 Nov. Change',
      }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Add to/ }));
    expect(
      await screen.findByText('Added 1 kg Potatoes to a new list, Week of 23 Nov'),
    ).toBeVisible();
  });

  it('counted items read "2 x Name"', async () => {
    api.searchProducts.mockResolvedValue(
      page([product(1, { name: 'Bananas', unitType: 'each' })], 1),
    );
    const { user } = await searchTab('/search?q=bananas');
    await user.click(await screen.findByRole('button', { name: 'Add Bananas to list' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Increase quantity' }));
    await user.click(await within(dialog).findByRole('button', { name: /^Add to Week/ }));
    expect(await screen.findByText('Added 2 x Bananas to Week of 23 Nov')).toBeVisible();
  });

  it('cancelling shows no toast and returns focus to Add', async () => {
    const { user, addButton } = await openPotatoes();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(addButton).toHaveFocus();
    expect(api.addThisWeekItem).not.toHaveBeenCalled();
  });

  it('a full list shows the banner in the sheet and keeps it open', async () => {
    api.addThisWeekItem.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'full', { code: 'CONFLICT', reason: 'LIMIT' }),
    );
    const { user, dialog } = await openPotatoes();
    await user.click(await within(dialog).findByRole('button', { name: /^Add to Week/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This list is full (200 items). Remove something first.',
    );
    expect(screen.getByRole('dialog', { name: 'Potatoes' })).toBeInTheDocument();
  });

  it('any other failure shows the generic banner and keeps the values', async () => {
    api.addThisWeekItem.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', null));
    const { user, dialog } = await openPotatoes();
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    await user.click(await within(dialog).findByRole('button', { name: /^Add to Week/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't add that item. Please try again.",
    );
    expect(within(dialog).getByRole('textbox', { name: /Quantity/ })).toHaveValue('2');
  });

  it('ticking Remember saves the unit override after the item is added', async () => {
    const { user, dialog } = await openPotatoes();
    await user.click(within(dialog).getByRole('radio', { name: 'g' }));
    await user.click(within(dialog).getByRole('button', { name: /^Add to Week/ }));
    await waitFor(() => expect(api.saveUnitOverride).toHaveBeenCalledWith('100001', 'g'));
  });

  it('a failed override save still keeps the added item and says so', async () => {
    api.saveUnitOverride.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', null));
    const { user, dialog } = await openPotatoes();
    await user.click(within(dialog).getByRole('radio', { name: 'g' }));
    await user.click(within(dialog).getByRole('button', { name: /^Add to Week/ }));
    expect(await screen.findByText("Added, but couldn't remember the unit.")).toBeVisible();
  });
});

describe('Search tab: target picker and context', () => {
  const potatoes = product(1, { name: 'Potatoes', unitType: 'kg', groupId: 'fruit-veg' });

  async function open(path: string, button = 'Add Potatoes to list') {
    api.searchProducts.mockResolvedValue(page([potatoes], 1));
    api.getLists.mockResolvedValue({
      lists: [
        listSummary(),
        listSummary({
          id: 'list-bbq',
          name: 'Birthday BBQ',
          thisWeek: false,
          itemCount: 14,
          tickedCount: 3,
        }),
      ],
    });
    const app = await searchTab(path);
    await app.user.click(await screen.findByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog', { name: /Potatoes|Choose where to add/ });
    return { ...app, dialog };
  }

  it('lists the lists then the templates, selects on tap and updates the button', async () => {
    const { user, dialog } = await open('/search?q=potato');
    await user.click(
      await within(dialog).findByRole('button', { name: /^Adding to Week of 23 Nov/ }),
    );
    const picker = await screen.findByRole('dialog', { name: 'Choose where to add' });
    expect(screen.getByRole('heading', { name: 'Choose where to add' })).toHaveFocus();
    const radios = within(picker)
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(radios[0]).toContain('Week of 23 Nov');
    expect(radios[1]).toContain('Birthday BBQ');
    expect(radios[2]).toContain('Weekly basics');
    expect(radios[3]).toContain('Tacos');
    expect(within(picker).getByRole('radio', { name: /Week of 23 Nov/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(within(picker).getByRole('radio', { name: /Tacos/ }));
    const form = await screen.findByRole('dialog', { name: 'Potatoes' });
    expect(within(form).getByText('Adding to template')).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Add to Tacos' }));
    expect(await screen.findByText('Added 1 kg Potatoes to Tacos')).toBeVisible();
    expect(api.addTemplateItem).toHaveBeenCalledWith('tpl-tacos', {
      productId: '100001',
      qty: 1,
      unit: 'kg',
      note: null,
    });
  });

  it('remembers the last target for the rest of the session', async () => {
    const first = await open('/search?q=potato');
    await first.user.click(await within(first.dialog).findByRole('button', { name: /^Adding to/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose where to add' });
    await first.user.click(within(picker).getByRole('radio', { name: /Birthday BBQ/ }));
    await first.user.click(await screen.findByRole('button', { name: 'Add to Birthday BBQ' }));
    await screen.findByText('Added 1 kg Potatoes to Birthday BBQ');
    expect(api.addListItem).toHaveBeenCalledWith('list-bbq', expect.objectContaining({ qty: 1 }));
    await first.user.click(screen.getByRole('button', { name: 'Add Potatoes to list' }));
    expect(await screen.findByRole('button', { name: 'Add to Birthday BBQ' })).toBeInTheDocument();
  });

  it('?list= shows the context bar, preselects that list and Done goes back to it', async () => {
    const { dialog } = await open('/search?q=potato&list=list-bbq');
    expect(screen.getByTestId('search-context')).toHaveTextContent('Adding to Birthday BBQ');
    expect(
      await within(dialog).findByRole('button', { name: 'Add to Birthday BBQ' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/lists/list-bbq');
  });

  it('?template= preselects the template and Done returns to it', async () => {
    const { dialog } = await open('/search?q=potato&template=tpl-tacos');
    expect(screen.getByTestId('search-context')).toHaveTextContent('Adding to template Tacos');
    expect(await within(dialog).findByRole('button', { name: 'Add to Tacos' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute(
      'href',
      '/templates/tpl-tacos',
    );
  });

  it('the ListPlus icon opens straight on the picker when no template is remembered', async () => {
    const { user, dialog } = await open('/search?q=potato', 'Add Potatoes to a template');
    expect(dialog).toHaveAccessibleName('Choose where to add');
    expect(screen.getByRole('heading', { name: 'Choose where to add' })).toHaveFocus();
    // Templates lead on this path.
    const radios = within(dialog)
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(radios[0]).toContain('Weekly basics');
    await user.click(within(dialog).getByRole('radio', { name: /Weekly basics/ }));
    expect(await screen.findByRole('button', { name: 'Add to Weekly basics' })).toBeVisible();
  });

  it('the ListPlus icon preselects the only template', async () => {
    api.getTemplates.mockResolvedValue({ templates: [templateSummary()] });
    const { dialog } = await open('/search?q=potato', 'Add Potatoes to a template');
    expect(dialog).toHaveAccessibleName('Potatoes');
    expect(await within(dialog).findByRole('button', { name: 'Add to Tacos' })).toBeVisible();
  });

  it('with no templates the New template form starts expanded, defaulting to Meal', async () => {
    api.getTemplates.mockResolvedValue({ templates: [] });
    const { dialog } = await open('/search?q=potato', 'Add Potatoes to a template');
    await within(dialog).findByText("You don't have any templates yet.");
    expect(within(dialog).getByLabelText('Template name')).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: 'Meal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('Search tab: product images', () => {
  it('lazy-loads photos and falls back to the initial on error', async () => {
    api.searchProducts.mockResolvedValue(
      page([product(1, { name: 'Milk', imageUrl: 'https://dm.apac.cms.aldi.cx/x.jpg' })], 1),
    );
    await searchTab('/search?q=milk');
    await screen.findByText('Milk');
    const img = document.querySelector('li img') as HTMLImageElement;
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width');
    img.dispatchEvent(new Event('error'));
    const fallback = await screen.findByTestId('image-fallback');
    expect(fallback).toHaveTextContent('M');
    expect(document.querySelector('li img')).toBeNull();
  });

  it('shows the initial when there is no image URL', async () => {
    api.searchProducts.mockResolvedValue(page([product(1, { name: 'bread', imageUrl: null })], 1));
    await searchTab('/search?q=bread');
    expect(await screen.findByTestId('image-fallback')).toHaveTextContent('B');
  });
});
