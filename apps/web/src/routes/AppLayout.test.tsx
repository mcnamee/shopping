// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMe: vi.fn(),
    getLists: vi.fn().mockResolvedValue({ lists: [] }),
    getTemplates: vi.fn().mockResolvedValue({ templates: [] }),
    getAisleOrder: vi.fn().mockResolvedValue({ groups: [], isDefault: true, version: 0 }),
    getUnitOverrides: vi.fn().mockResolvedValue({ overrides: [] }),
    getHistory: vi.fn().mockResolvedValue({ lists: [], nextCursor: null }),
  };
});

import { ApiError, getMe } from '../api';
import { makeAuth, renderApp } from '../test/render';

async function signedInApp(path: string) {
  const auth = makeAuth();
  await auth.signIn('alex@example.com', 'Password1');
  return renderApp(path, { auth });
}

beforeEach(() => {
  vi.mocked(getMe).mockResolvedValue({
    userId: 'u1',
    email: 'alex@example.com',
    householdId: 'h1',
  });
});

describe('bottom navigation', () => {
  it('renders four labelled tab links in the main nav', async () => {
    await signedInApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Lists', 'Products', 'Recipes', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/search',
      '/recipes',
      '/settings',
    ]);
  });

  it.each([
    ['/', 'Lists'],
    ['/search', 'Products'],
    ['/recipes', 'Recipes'],
    ['/settings', 'Settings'],
  ])('marks only the %s tab as current', async (path, label) => {
    await signedInApp(path);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
    // The app bar title (h1) matches the active tab.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(label);
  });

  it('updates the active tab when navigating', async () => {
    const { user } = await signedInApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Products' }));
    expect(within(nav).getByRole('link', { name: 'Products' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Lists' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('searchbox', { name: 'Search products' })).toBeInTheDocument();
  });

  it('shows the empty states for Lists and Templates', async () => {
    await signedInApp('/templates');
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
  });

  it.each(['/lists/history', '/templates', '/recipes/new', '/settings/units'])(
    'hides the bottom nav on pushed screen %s, keeping a back button',
    async (path) => {
      await signedInApp(path);
      expect(await screen.findByRole('link', { name: /^Back/ })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--nav-height')).toBe(
        'var(--safe-bottom)',
      );
    },
  );

  it('sets the full nav height on tab roots', async () => {
    await signedInApp('/');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(document.documentElement.style.getPropertyValue('--nav-height')).toContain('64px');
  });
});

describe('/me handling', () => {
  it('shows an account-not-set-up state on 403 NO_HOUSEHOLD', async () => {
    vi.mocked(getMe).mockRejectedValue(
      new ApiError(403, 'NO_HOUSEHOLD', 'This account is not linked to a household', {}),
    );
    await signedInApp('/');
    expect(await screen.findByText("Your account isn't set up yet")).toBeInTheDocument();
    // Settings stays reachable so the user can sign out.
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a retryable banner on other failures', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    await signedInApp('/');
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      "Can't reach Trolley right now.",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(await screen.findByText('No lists yet')).toBeInTheDocument();
  });
});
