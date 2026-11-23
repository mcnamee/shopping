// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);
const goExternal = vi.fn();
vi.mock('../lib/navigate', () => ({ goExternal: (u: string) => goExternal(u) }));

beforeEach(() => goExternal.mockClear());
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 300));
});

describe('/connect', () => {
  it('shows consent details and Allow sends the browser to the redirect URL', async () => {
    const { user } = await renderMockApp('/connect?request=mock-claude');
    await screen.findByRole('heading', { level: 1, name: /Allow Claude to view and add/ });
    expect(screen.getByText("You'll be sent back to claude.ai")).toBeVisible();
    expect(screen.getByText('Search products')).toBeVisible();
    expect(screen.getByText('alex@example.com')).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(goExternal).toHaveBeenCalledTimes(1));
    const url = new URL(goExternal.mock.calls[0]![0] as string);
    expect(url.host).toBe('claude.ai');
    expect(url.searchParams.get('code')).toBe('mock-code');
  });

  it('Deny redirects with access_denied', async () => {
    const { user } = await renderMockApp('/connect?request=mock-chatgpt');
    await screen.findByRole('button', { name: 'Deny' });
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(goExternal).toHaveBeenCalled());
    expect(new URL(goExternal.mock.calls[0]![0] as string).searchParams.get('error')).toBe(
      'access_denied',
    );
  });

  it('renders a long client name as plain text', async () => {
    await renderMockApp('/connect?request=mock-long');
    const h = await screen.findByRole('heading', { level: 1 });
    expect(h.textContent).toContain('A very long connector name');
  });

  it('shows the invalid-link state for unknown or missing requests', async () => {
    await renderMockApp('/connect?request=nope');
    expect(
      await screen.findByText("This connection link isn't valid or has expired"),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Trolley' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    cleanup();
    await renderMockApp('/connect');
    expect(
      await screen.findByText("This connection link isn't valid or has expired"),
    ).toBeVisible();
  });
});
