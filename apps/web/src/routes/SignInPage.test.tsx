// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthError, type AuthService } from '../auth';
import { makeAuth, renderApp } from '../test/render';

const field = (name: string) => screen.getByLabelText(name, { exact: true });

async function fillAndSubmit(
  user: ReturnType<typeof renderApp>['user'],
  email: string,
  password: string,
) {
  await user.type(field('Email'), email);
  await user.type(field('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInPage', () => {
  it('redirects unauthenticated users from app routes to sign in', async () => {
    const { pathname } = renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Trolley' })).toBeInTheDocument();
    expect(pathname()).toBe('/sign-in');
  });

  it('has labelled fields, forgot link and no sign-up link', async () => {
    renderApp('/sign-in');
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(field('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.queryByText(/sign up|create account/i)).not.toBeInTheDocument();
    await waitFor(() => expect(field('Email')).toHaveFocus());
  });

  it('validates on submit and focuses the first invalid field', async () => {
    const { user } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    await waitFor(() => expect(field('Email')).toHaveFocus());
    expect(field('Email')).toHaveAttribute('aria-invalid', 'true');

    await user.type(field('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText("That email address doesn't look right.")).toBeInTheDocument();

    await user.clear(field('Email'));
    await user.type(field('Email'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(field('Password')).toHaveFocus();
  });

  it('shows the wrong-credentials banner and re-focuses the password', async () => {
    const { user } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'a@example.com', 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password. Please try again.',
    );
    expect(field('Password')).toHaveFocus();
  });

  it('shows the too-many-attempts banner', async () => {
    const { user } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'locked@example.com', 'whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a few minutes, then try again.',
    );
  });

  it('explains an expired temporary password', async () => {
    const { user } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'expired@example.com', 'whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporary password has expired/i);
  });

  it('shows the network banner and keeps the button enabled', async () => {
    const base = makeAuth();
    const auth: AuthService = {
      ...base,
      signIn: () => Promise.reject(new AuthError('NETWORK', 'offline')),
    };
    const { user } = renderApp('/sign-in', { auth });
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'a@example.com', 'Password1');
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Trolley right now.");
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('disables the button with a busy label while submitting', async () => {
    let release: () => void = () => {};
    const base = makeAuth();
    const auth: AuthService = {
      ...base,
      signIn: () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'UNSUPPORTED_STEP', step: 'MFA' });
        }),
    };
    const { user } = renderApp('/sign-in', { auth });
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'a@example.com', 'Password1');
    const busy = await screen.findByRole('button', { name: 'Signing in...' });
    expect(busy).toBeDisabled();
    expect(field('Email')).toHaveAttribute('readonly');
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't sign you in/i);
  });

  it('toggles password visibility', async () => {
    const { user } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(field('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('signs in and lands on Lists', async () => {
    const { user, pathname } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'a@example.com', 'Password1');
    await waitFor(() => expect(pathname()).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Lists', level: 1 })).toBeInTheDocument();
  });

  it('routes to /new-password on a temporary-password challenge', async () => {
    const { user, pathname } = renderApp('/sign-in');
    await screen.findByLabelText('Email');
    await fillAndSubmit(user, 'new@example.com', 'TempPass1');
    await waitFor(() => expect(pathname()).toBe('/new-password'));
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });

  it('carries the email to forgot password', async () => {
    const { user, pathname } = renderApp('/sign-in');
    await user.type(await screen.findByLabelText('Email'), 'a@example.com');
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(pathname()).toBe('/forgot-password');
    expect(field('Email')).toHaveValue('a@example.com');
  });
});
