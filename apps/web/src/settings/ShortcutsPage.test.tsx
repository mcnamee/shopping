// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 300));
});

describe('Siri & Shortcuts settings', () => {
  it('creates a key, shows it once with Copy, lists it and builds the header value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await renderMockApp('/settings/shortcuts');
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    expect(await screen.findByText('No keys yet.')).toBeVisible();
    // Instructions use the page's own origin and a placeholder until a key exists.
    expect(screen.getByTestId('quick-add-url')).toHaveTextContent(
      `${window.location.origin}/api/quick/add`,
    );
    expect(screen.getByTestId('quick-auth-header')).toHaveTextContent('Bearer <your key>');

    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText(/Give the key a name/)).toBeVisible();
    await user.type(screen.getByLabelText('Key name'), "Matt's iPhone");
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const panel = await screen.findByRole('region', { name: 'Your new key' });
    const key = within(panel).getByTestId('new-key').textContent ?? '';
    expect(key).toMatch(/^trl_/);
    expect(within(panel).getByText(/won.t be shown again/)).toBeVisible();
    expect(screen.getByTestId('quick-auth-header')).toHaveTextContent(`Bearer ${key}`);
    await user.click(within(panel).getByRole('button', { name: 'Copy key' }));
    expect(writeText).toHaveBeenCalledWith(key);
    await user.click(screen.getByRole('button', { name: 'Copy header value' }));
    expect(writeText).toHaveBeenCalledWith(`Bearer ${key}`);

    await user.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('new-key')).toBeNull();
    expect(screen.queryByText(key)).toBeNull();
    const items = within(await screen.findByRole('list', { name: 'Keys' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText("Matt's iPhone")).toBeVisible();
    expect(within(items[0]!).getByText(/never used/)).toBeVisible();
  });

  it('Revoke confirms, removes and toasts', async () => {
    const { user } = await renderMockApp('/settings/shortcuts');
    await screen.findByText('No keys yet.');
    await user.type(screen.getByLabelText('Key name'), 'Kitchen iPad');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke Kitchen iPad' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Revoke Kitchen iPad?' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Revoke Kitchen iPad' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' }),
    );
    expect(await screen.findByText('Kitchen iPad revoked')).toBeVisible();
    await waitFor(() => expect(screen.getByText('No keys yet.')).toBeVisible());
  });

  it('is reachable from Settings', async () => {
    const { user } = await renderMockApp('/settings');
    await user.click(await screen.findByRole('link', { name: /Siri & Shortcuts/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Siri & Shortcuts' }),
    ).toBeVisible();
  });
});
