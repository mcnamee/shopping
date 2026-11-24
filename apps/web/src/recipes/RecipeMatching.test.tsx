// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { ListDetail, Recipe } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { MOCK_RECIPE_IDS } from '../api/mock-stage5';
import { resetTickQueue } from '../offline/tickQueue';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth';
import { ToastProvider } from '../components/Toast';
import { callMock, installMockApi, failNext } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const OLIVE_OIL = 'Extra Virgin Olive Oil 750ml';
const LIST = `/lists/${MOCK_SEED_IDS.thisWeekList}`;

beforeEach(() => {
  vi.stubGlobal('__mockApiDelay', null);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetTickQueue();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

type Opts = {
  ingredients?: string;
  delayMatchMs?: number;
  failMatch?: boolean;
  matchCalls?: string[];
};

/** Signed in against fresh mock data, optionally with a new recipe, at its detail page. */
async function openSheet(recipeId: string | null, opts: Opts = {}) {
  const auth = await installMockApi();
  let id = recipeId;
  if (opts.ingredients !== undefined) {
    id = (
      await callMock<Recipe>('POST', '/recipes', {
        title: 'Matching dish',
        ingredients: opts.ingredients,
      })
    ).body.id;
  }
  if (opts.delayMatchMs) {
    vi.stubGlobal('__mockApiDelay', {
      match: `POST /api/recipes/${id}/match`,
      ms: opts.delayMatchMs,
    });
  }
  if (opts.failMatch) failNext(`POST /api/recipes/${id}/match`);
  if (opts.matchCalls) {
    const real = globalThis.fetch;
    const calls = opts.matchCalls;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/match')) calls.push(url);
      return real(input, init);
    });
  }
  const user = userEvent.setup();
  const router = createMemoryRouter([{ path: '*', element: <AppRoutes /> }], {
    initialEntries: [`/recipes/${id}`],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider auth={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Add to list' }, { timeout: 3000 }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('radio', { name: /Week of/ });
  return { user, dialog };
}

const settled = (dialog: HTMLElement) =>
  waitFor(() => expect(within(dialog).queryByText(/Finding ALDI products/)).toBeNull(), {
    timeout: 4000,
  });

describe('smart Add to list', () => {
  it('reopens instantly from the session cache and refreshes on request (D-116)', async () => {
    const matchCalls: string[] = [];
    const { user, dialog } = await openSheet(MOCK_RECIPE_IDS.greekSalad, { matchCalls });
    await settled(dialog);
    expect(matchCalls).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    const again = await screen.findByRole('dialog');
    // Matched at once: no loading hint, no second request.
    expect(within(again).queryByText(/Finding ALDI products/)).toBeNull();
    expect(within(again).getByRole('checkbox', { name: new RegExp(OLIVE_OIL) })).toBeVisible();
    expect(matchCalls).toHaveLength(1);
    await user.click(within(again).getByRole('button', { name: 'Refresh matches' }));
    await waitFor(() => expect(matchCalls).toHaveLength(2));
    expect(matchCalls[1]).toContain('refresh=1');
    await settled(again);
    expect(within(again).getByRole('checkbox', { name: new RegExp(OLIVE_OIL) })).toBeVisible();
  });

  it('opens with free-text rows, then upgrades matches to ALDI products', async () => {
    const { dialog } = await openSheet(MOCK_RECIPE_IDS.greekSalad, { delayMatchMs: 1500 });
    // Immediately: the loading hint and plain text rows.
    expect(within(dialog).getByText(/Finding ALDI products/)).toBeVisible();
    expect(within(dialog).getByText('3 tbsp olive oil')).toBeVisible();
    await settled(dialog);
    const row = within(dialog).getByRole('checkbox', { name: new RegExp(OLIVE_OIL) });
    expect(row).toHaveTextContent(`1 x ${OLIVE_OIL}`);
    expect(row).toHaveTextContent('3 tbsp olive oil');
    expect(row.querySelector('[data-testid="image-fallback"], img')).not.toBeNull();
    // A line with no confident product stays as written, with no product chip.
    const oregano = within(dialog).getByRole('checkbox', { name: '1 tsp dried oregano' });
    expect(oregano).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /for 1 tsp dried oregano/ })).toBeNull();
  });

  it('switches a row to its alternatives or back to text with the chip', async () => {
    const { user, dialog } = await openSheet(MOCK_RECIPE_IDS.greekSalad);
    await settled(dialog);
    await user.click(
      within(dialog).getByRole('button', { name: 'Change product for 3 tbsp olive oil' }),
    );
    const group = within(dialog).getByRole('radiogroup', { name: 'Product for 3 tbsp olive oil' });
    expect(within(group).getByRole('radio', { name: new RegExp(OLIVE_OIL) })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(group).getByRole('radio', { name: 'Keep as text' }));
    expect(within(dialog).getByRole('checkbox', { name: '3 tbsp olive oil' })).toBeVisible();
    expect(within(dialog).queryByText(`1 x ${OLIVE_OIL}`)).toBeNull();
    // The chip offers the product again.
    await user.click(
      within(dialog).getByRole('button', { name: 'Choose a product for 3 tbsp olive oil' }),
    );
    await user.click(within(dialog).getByRole('radio', { name: new RegExp(OLIVE_OIL) }));
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(OLIVE_OIL) })).toBeVisible();
  });

  it('unticks pantry staples with a hint, from the start', async () => {
    const { dialog } = await openSheet(null, {
      ingredients: '2 tbsp olive oil\nSalt and pepper, to taste\n1 cup water',
    });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(within(dialog).getAllByText('Probably have')).toHaveLength(2);
    expect(within(dialog).getAllByText('1 of 3 selected').length).toBeGreaterThan(0);
    await settled(dialog);
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((b) => b.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false']);
  });

  it('adds products and text in one go, and one Undo removes both', async () => {
    const { user, dialog } = await openSheet(null, {
      ingredients: '2 tbsp olive oil\n1 dragon fruit foam',
    });
    await settled(dialog);
    const before = (await callMock<ListDetail>('GET', LIST)).body;
    await user.click(within(dialog).getByRole('button', { name: /^Add 2 to Week of/ }));
    expect(await screen.findByText(/^Added 2 to Week of/)).toBeVisible();
    const after = (await callMock<ListDetail>('GET', LIST)).body;
    const oil = after.items.find((i) => i.product.name === OLIVE_OIL);
    expect(oil).toMatchObject({ qty: 1, unit: 'each', note: 'From Matching dish' });
    expect(after.items.find((i) => i.kind === 'text')?.product.name).toBe('1 dragon fruit foam');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const undone = (await callMock<ListDetail>('GET', LIST)).body;
      expect(undone.items.length).toBe(before.items.length);
    });
  });

  it('keeps free text silently when matching fails', async () => {
    const { dialog } = await openSheet(MOCK_RECIPE_IDS.greekSalad, { failMatch: true });
    await settled(dialog);
    expect(within(dialog).getByRole('checkbox', { name: '3 tbsp olive oil' })).toBeVisible();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).queryByText(OLIVE_OIL)).toBeNull();
  });
});
