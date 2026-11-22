// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getMe: vi.fn() };
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
    expect(links.map((l) => l.textContent)).toEqual(['Lists', 'Search', 'Templates', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/search',
      '/templates',
      '/settings',
    ]);
  });

  it.each([
    ['/', 'Lists'],
    ['/search', 'Search'],
    ['/templates', 'Templates'],
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
    await user.click(within(nav).getByRole('link', { name: 'Search' }));
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Lists' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByText('Search is coming soon')).toBeInTheDocument();
  });

  it('shows the placeholder copy for each tab', async () => {
    await signedInApp('/templates');
    expect(await screen.findByText('Templates are coming soon')).toBeInTheDocument();
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
    expect(screen.getByText('Lists are coming soon')).toBeInTheDocument();
  });
});
