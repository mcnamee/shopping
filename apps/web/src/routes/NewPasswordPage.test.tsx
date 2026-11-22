// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';

const field = (name: string) => screen.getByLabelText(name, { exact: true });

async function reachNewPassword() {
  const app = renderApp('/sign-in');
  await app.user.type(await screen.findByLabelText('Email'), 'new@example.com');
  await app.user.type(field('Password'), 'TempPass1');
  await app.user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Choose a new password' });
  return app;
}

const rule = (text: string) => screen.getByText(text).closest('li')!;

describe('NewPasswordPage', () => {
  it('redirects to sign in with a timeout notice when there is no challenge (e.g. refresh)', async () => {
    const { pathname } = renderApp('/new-password');
    expect(await screen.findByText(/Your session timed out/)).toBeInTheDocument();
    expect(pathname()).toBe('/sign-in');
  });

  it('focuses the new password field and shows the rules as unmet', async () => {
    await reachNewPassword();
    await waitFor(() => expect(field('New password')).toHaveFocus());
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite');
    for (const text of [
      'At least 8 characters',
      'An uppercase letter (A-Z)',
      'A lowercase letter (a-z)',
      'A number (0-9)',
    ]) {
      expect(within(rule(text)).getByText(/not met/)).toBeInTheDocument();
    }
  });

  it('updates the rules checklist live as the user types', async () => {
    const { user } = await reachNewPassword();
    await user.type(field('New password'), 'abc');
    expect(within(rule('A lowercase letter (a-z)')).getByText(/- met/)).toBeInTheDocument();
    expect(within(rule('An uppercase letter (A-Z)')).getByText(/not met/)).toBeInTheDocument();
    expect(within(rule('At least 8 characters')).getByText(/not met/)).toBeInTheDocument();

    await user.type(field('New password'), 'DEF123');
    for (const text of [
      'At least 8 characters',
      'An uppercase letter (A-Z)',
      'A lowercase letter (a-z)',
      'A number (0-9)',
    ]) {
      expect(within(rule(text)).getByText(/- met/)).toBeInTheDocument();
    }
  });

  it('turns unmet rules into errors only after a failed submit', async () => {
    const { user } = await reachNewPassword();
    await user.type(field('New password'), 'abc');
    expect(screen.queryByText("Your password doesn't meet all the rules below.")).toBeNull();
    await user.type(field('Confirm new password'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByText("Your password doesn't meet all the rules below.")).toBeInTheDocument();
    expect(field('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(field('New password')).toHaveFocus();
    expect(rule('A number (0-9)').className).toMatch(/text-danger/);
  });

  it('shows empty and mismatch errors', async () => {
    const { user } = await reachNewPassword();
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByText('Enter a new password.')).toBeInTheDocument();
    expect(screen.getByText('Confirm your new password.')).toBeInTheDocument();

    await user.type(field('New password'), 'Abcdefg1');
    await user.type(field('Confirm new password'), 'Abcdefg2');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(field('Confirm new password')).toHaveFocus();
  });

  it('saves, signs in, lands on Lists and shows the toast', async () => {
    const { user, pathname } = await reachNewPassword();
    await user.type(field('New password'), 'Abcdefg1');
    await user.type(field('Confirm new password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(pathname()).toBe('/'));
    expect(await screen.findByText("Password saved. You're signed in.")).toBeInTheDocument();
  });

  it('goes back to sign in', async () => {
    const { user, pathname } = await reachNewPassword();
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }));
    expect(pathname()).toBe('/sign-in');
  });
});
