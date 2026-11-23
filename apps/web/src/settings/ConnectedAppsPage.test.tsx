// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callMock, renderMockApp } from '../test/mockApp';
import { lastUsedLabel } from './connectedAppsFormat';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 300));
});

describe('lastUsedLabel', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  it('formats relative times', () => {
    expect(lastUsedLabel(null, now)).toBe('never used');
    expect(lastUsedLabel('2026-11-23T11:59:50Z', now)).toBe('last used just now');
    expect(lastUsedLabel('2026-11-23T11:55:00Z', now)).toBe('last used 5 min ago');
    expect(lastUsedLabel('2026-11-23T10:00:00Z', now)).toBe('last used 2 h ago');
    expect(lastUsedLabel('2026-11-20T12:00:00Z', now)).toBe('last used 3 days ago');
  });
});

describe('Connected apps', () => {
  it('empty state shows the MCP address, Copy and steps', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await renderMockApp('/settings/connected-apps');
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    expect(await screen.findByText('No apps connected')).toBeVisible();
    expect(screen.getByTestId('mcp-url')).toHaveTextContent('https://trolley.mcn.am/mcp');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://trolley.mcn.am/mcp');
    expect(await screen.findByText('Copied')).toBeVisible();
    expect(screen.getByText('How to connect')).toBeVisible();
  });

  it('lists apps and Disconnect confirms, removes and toasts', async () => {
    const { user } = await renderMockApp('/settings/connected-apps');
    await screen.findByText('No apps connected');
    await callMock('POST', '/oauth/consent', { requestId: 'mock-long', allow: true });
    await callMock('POST', '/oauth/consent', { requestId: 'mock-claude', allow: true });
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    const items = await within(
      await screen.findByRole('list', { name: 'Connected apps' }),
    ).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Claude')).toBeVisible();
    expect(within(items[0]!).getByText(/by alex - never used/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Disconnect Claude?' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }),
    );
    expect(await screen.findByText('Claude disconnected')).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Connected apps' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
  });
});
