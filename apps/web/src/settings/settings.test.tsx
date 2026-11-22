// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AisleOrderResponse, UnitOverridesResponse } from '@trolley/core';
import { DEFAULT_GROUPS } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { callMock, failNext, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const log = () => (globalThis as { __mockApiLog?: string[] }).__mockApiLog ?? [];
beforeEach(() => {
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog = [];
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 600));
});

const refocus = () =>
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });

async function aisle() {
  const app = await renderMockApp('/settings/aisle-order');
  await screen.findByRole('list', { name: 'Aisle order' }, { timeout: 3000 });
  return app;
}
const names = () =>
  within(screen.getByRole('list', { name: 'Aisle order' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent?.replace(/^\d+/, '').trim());
const defaults = DEFAULT_GROUPS.map((g) => g.name);
const puts = () => log().filter((c) => c.startsWith('PUT /api/settings/aisle-order'));

describe('Aisle order', () => {
  it('shows the 15 groups numbered in ALDI order with Reset disabled', async () => {
    await aisle();
    expect(names()).toEqual(defaults);
    expect(
      screen.getByText(
        'Shop mode follows this order, top to bottom. Drag the handle, or use the arrows.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move Fruit & Veg up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move Other down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Reset to ALDI order' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Already using the ALDI order.')).toBeVisible();
  });

  it('moves a row with the arrows, keeps focus on the button, announces and saves once', async () => {
    const { user } = await aisle();
    const down = screen.getByRole('button', { name: 'Move Bakery down' });
    await user.click(down);
    await user.click(screen.getByRole('button', { name: 'Move Bakery down' }));
    await user.click(screen.getByRole('button', { name: 'Move Bakery up' }));
    expect(names().slice(0, 4)).toEqual(['Fruit & Veg', 'Meat & Seafood', 'Bakery', 'Deli']);
    expect(screen.getByRole('button', { name: 'Move Bakery up' })).toHaveFocus();
    expect(screen.getByText('Bakery moved up. Position 3 of 15.')).toBeInTheDocument();
    expect(screen.getByText('Saving...')).toBeVisible();
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeVisible();
    expect(puts()).toHaveLength(1);
    const saved = (await callMock<AisleOrderResponse>('GET', '/settings/aisle-order')).body;
    expect(saved.groups.slice(0, 3).map((g) => g.id)).toEqual([
      'fruit-veg',
      'meat-seafood',
      'bakery',
    ]);
    expect(saved.isDefault).toBe(false);
  });

  it('moves focus to the other arrow when a button reaches the end', async () => {
    const { user } = await aisle();
    await user.click(screen.getByRole('button', { name: 'Move Bakery up' }));
    // Bakery is now first: Up is disabled, so focus lands on Down.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move Bakery down' })).toHaveFocus(),
    );
    expect(screen.getByRole('button', { name: 'Move Bakery up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('reorders by dragging the handle', async () => {
    await aisle();
    const handle = screen.getByTestId('drag-bakery');
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { clientY: 365, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { clientY: 430, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(handle, { clientY: 430, pointerId: 1, pointerType: 'touch' });
    expect(names().slice(0, 4)).toEqual(['Fruit & Veg', 'Meat & Seafood', 'Deli', 'Bakery']);
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeVisible();
  });

  it('Escape cancels a drag', async () => {
    await aisle();
    const handle = screen.getByTestId('drag-bakery');
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { clientY: 430, pointerId: 1, pointerType: 'touch' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(handle, { clientY: 430, pointerId: 1, pointerType: 'touch' });
    expect(names()).toEqual(defaults);
    expect(puts()).toHaveLength(0);
  });

  it('rolls back a failed save and offers Try again', async () => {
    const { user } = await aisle();
    failNext('PUT /api/settings/aisle-order', 500);
    await user.click(screen.getByRole('button', { name: 'Move Bakery down' }));
    expect(names()[1]).toBe('Meat & Seafood');
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      "Couldn't save the new order. Please try again.",
    );
    expect(names()).toEqual(defaults);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeVisible();
    expect(names()[1]).toBe('Meat & Seafood');
  });

  it('a stale save (409) shows "Changed on another phone." and Show latest reloads', async () => {
    const { user } = await aisle();
    failNext('PUT /api/settings/aisle-order', 409);
    await user.click(screen.getByRole('button', { name: 'Move Bakery down' }));
    expect(
      await screen.findByText('Changed on another phone.', {}, { timeout: 3000 }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show latest' }));
    await waitFor(() => expect(names()).toEqual(defaults));
  });

  it('Reset asks first, restores the ALDI order and offers Undo', async () => {
    const { user } = await aisle();
    await user.click(screen.getByRole('button', { name: 'Move Bakery down' }));
    await screen.findByText('Saved', {}, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Reset to ALDI order' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Reset the aisle order?' });
    expect(confirm).toHaveTextContent(
      'Groups go back to the usual ALDI walk order. Your lists will follow it straight away.',
    );
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Reset order' }));
    await waitFor(() => expect(names()).toEqual(defaults));
    expect(await screen.findByText('Aisle order reset to ALDI order')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(names()[1]).toBe('Meat & Seafood'));
  });

  it('shop mode follows the household order on the next refresh', async () => {
    await renderMockApp(`/lists/${MOCK_SEED_IDS.thisWeekList}`);
    await screen.findByRole('heading', { level: 1, name: /Week of/ });
    const first = () => screen.getAllByRole('heading', { level: 2 })[0]?.textContent;
    expect(first()).toMatch(/^Fruit & Veg/);
    const order = DEFAULT_GROUPS.map((g) => g.id).filter((id) => id !== 'bakery');
    await callMock('PUT', '/settings/aisle-order', { order: ['bakery', ...order] });
    refocus();
    await waitFor(() => expect(first()).toMatch(/^Bakery/));
  });

  it('shows an error with Try again when it fails to load', async () => {
    await renderMockApp('/settings/aisle-order', {
      fail: { match: 'GET /api/settings/aisle-order', times: 2 },
    });
    expect(
      await screen.findByText("Couldn't load your aisle order", {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

const SKUS = [
  '000000000000380234',
  '000000000000380086',
  '000000000000380084',
  '000000000000380072',
  '000000000000308272',
  '000000000000704838',
  '000000000000399496',
  '000000000000401302',
  '000000000000398689',
];

async function units(count: number) {
  const app = await renderMockApp('/settings/units');
  await screen.findByRole('heading', { level: 1, name: 'Remembered units' });
  await screen.findByText('No remembered units');
  for (const sku of SKUS.slice(0, count)) {
    await callMock('PUT', `/settings/unit-overrides/${sku}`, { unit: 'mL' });
  }
  refocus();
  return app;
}

describe('Remembered units', () => {
  it('shows the empty state', async () => {
    await renderMockApp('/settings/units');
    expect(await screen.findByRole('heading', { name: 'No remembered units' })).toBeVisible();
    expect(
      screen.getByText(
        'When you pick a different unit in the quantity box and tick Remember, it shows up here.',
      ),
    ).toBeVisible();
  });

  it('lists products with the unit they open in, sorted by name', async () => {
    await units(2);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Opens in mL \(usually \w+\)/);
    const labels = rows.map((r) => within(r).getByRole('button').getAttribute('aria-label'));
    expect(labels.every((l) => /^Forget mL for /.test(l ?? ''))).toBe(true);
    expect([...labels].sort()).toEqual(labels);
    expect(screen.queryByRole('searchbox', { name: 'Filter remembered units' })).toBeNull();
  });

  it('Forget removes the row at once with an Undo toast that restores it', async () => {
    const { user } = await units(2);
    const rows = await screen.findAllByRole('listitem');
    const forget = within(rows[0] as HTMLElement).getByRole('button');
    await user.click(forget);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(await screen.findByText(/will open in \w+ again$/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const after = (await callMock<UnitOverridesResponse>('GET', '/settings/unit-overrides')).body;
    expect(after.overrides).toHaveLength(2);
  });

  it('rolls back a failed Forget', async () => {
    const { user } = await units(1);
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    failNext('DELETE /api/settings/unit-overrides', 500);
    await user.click(within(row).getByRole('button'));
    expect(await screen.findByText("Couldn't save. Check your connection.")).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('adds a filter field from 8 rows and says when nothing matches', async () => {
    const { user } = await units(9);
    const filter = await screen.findByRole('searchbox', { name: 'Filter remembered units' });
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    await user.type(filter, 'zzz');
    expect(screen.getByText("No matches for 'zzz'.")).toBeVisible();
    await user.clear(filter);
    await user.type(filter, 'banana');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
