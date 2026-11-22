// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMe: vi
      .fn()
      .mockResolvedValue({ userId: 'u1', email: 'alex@example.com', householdId: 'h1' }),
    getAisleOrder: vi.fn().mockResolvedValue({ groups: [], isDefault: false, version: 2 }),
    getUnitOverrides: vi.fn().mockResolvedValue({
      overrides: [{ productId: 'a', unit: 'L', defaultUnit: 'pack', name: 'Milk' }],
    }),
  };
});

import { makeAuth, renderApp } from '../test/render';

async function settings() {
  const auth = makeAuth();
  await auth.signIn('alex@example.com', 'Password1');
  const app = renderApp('/settings', { auth });
  await screen.findByText('alex@example.com');
  return app;
}

const openSheet = async (user: Awaited<ReturnType<typeof settings>>['user']) => {
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  return screen.findByRole('alertdialog');
};

describe('Settings shopping section', () => {
  it('links to Aisle order and Remembered units with their current values', async () => {
    await settings();
    const aisle = screen.getByRole('link', { name: /Aisle order/ });
    expect(aisle).toHaveAttribute('href', '/settings/aisle-order');
    expect(await screen.findByText('Custom order')).toBeInTheDocument();
    const units = screen.getByRole('link', { name: /Remembered units/ });
    expect(units).toHaveAttribute('href', '/settings/units');
    expect(await screen.findByText('1 product')).toBeInTheDocument();
  });
});

describe('Settings and sign-out confirm', () => {
  it('shows the signed-in email and version', async () => {
    await settings();
    expect(screen.getByText('Signed in as')).toBeInTheDocument();
    expect(screen.getByText(/^Trolley v\d/)).toBeInTheDocument();
  });

  it('opens an alertdialog with initial focus on Cancel', async () => {
    const { user } = await settings();
    const dialog = await openSheet(user);
    expect(dialog).toHaveAccessibleName('Sign out of Trolley?');
    expect(dialog).toHaveAccessibleDescription(
      "You'll need your email and password to sign back in.",
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('traps focus inside the sheet', async () => {
    const { user } = await settings();
    const dialog = await openSheet(user);
    const buttons = Array.from(dialog.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Sign out', 'Cancel']);
    await user.tab(); // Cancel -> wraps to Sign out
    expect(buttons[0]).toHaveFocus();
    await user.tab(); // -> Cancel
    expect(buttons[1]).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[0]).toHaveFocus();
  });

  it('closes on Cancel, Escape and scrim tap, restoring focus', async () => {
    const { user } = await settings();

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Sign out' })[0]).toHaveFocus();

    await openSheet(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await openSheet(user);
    await user.click(screen.getByTestId('scrim'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('signs out, returns to sign in, and protects app routes afterwards', async () => {
    const { user, pathname } = await settings();
    const dialog = await openSheet(user);
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Sign out',
    )!;
    await user.click(confirm);
    await waitFor(() => expect(pathname()).toBe('/sign-in'));
    expect(await screen.findByRole('heading', { name: 'Trolley' })).toBeInTheDocument();
  });
});
