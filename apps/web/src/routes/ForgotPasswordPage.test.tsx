// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, type AuthService } from '../auth';
import { makeAuth, renderApp } from '../test/render';

const field = (name: string) => screen.getByLabelText(name, { exact: true });

async function toStep2(user: ReturnType<typeof renderApp>['user'], email = 'a@example.com') {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByRole('heading', { name: 'Check your email' });
}

afterEach(() => vi.useRealTimers());

// One second per act() so React re-renders (and re-arms the countdown timer) between ticks.
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe('ForgotPasswordPage', () => {
  it('step 1 validates the email', async () => {
    const { user } = renderApp('/forgot-password');
    await screen.findByLabelText('Email');
    await waitFor(() => expect(field('Email')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    await user.type(field('Email'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByText("That email address doesn't look right.")).toBeInTheDocument();
  });

  it('prefills the email from sign in and focuses the button', async () => {
    const { user } = renderApp('/sign-in');
    await user.type(await screen.findByLabelText('Email'), 'a@example.com');
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(field('Email')).toHaveValue('a@example.com');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send code' })).toHaveFocus());
  });

  it('completes the two-step flow and returns to sign in with a success message', async () => {
    const { user, pathname } = renderApp('/forgot-password');
    await toStep2(user);

    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    const code = field('Code');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');

    // Non-digits are stripped (paste).
    await user.click(code);
    await user.paste('12-34 56');
    expect(code).toHaveValue('123456');

    await user.type(field('New password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(pathname()).toBe('/sign-in'));
    expect(
      await screen.findByText('Password reset. Sign in with your new password.'),
    ).toBeInTheDocument();
    expect(field('Email')).toHaveValue('a@example.com');
    expect(field('Password')).toHaveFocus();
  });

  it('shows code and password validation in step 2', async () => {
    const { user } = renderApp('/forgot-password');
    await toStep2(user);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Enter the 6-digit code from your email.')).toBeInTheDocument();

    await user.type(field('Code'), '123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('The code is 6 digits.')).toBeInTheDocument();

    await user.type(field('Code'), '456');
    await user.type(field('New password'), 'weak');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText("Your password doesn't meet all the rules below.")).toBeInTheDocument();
  });

  it('flags a wrong code and refocuses the code field', async () => {
    const { user } = renderApp('/forgot-password');
    await toStep2(user);
    await user.type(field('Code'), '000000');
    await user.type(field('New password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(
      await screen.findByText("That code isn't right. Check your email and try again."),
    ).toBeInTheDocument();
    expect(field('Code')).toHaveFocus();
  });

  it('shows the expired-code message', async () => {
    const base = makeAuth();
    const auth: AuthService = {
      ...base,
      confirmResetPassword: () => Promise.reject(new AuthError('EXPIRED_CODE', 'expired')),
    };
    const { user } = renderApp('/forgot-password', { auth });
    await toStep2(user);
    await user.type(field('Code'), '123456');
    await user.type(field('New password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code has expired. Tap Resend to get a new one.',
    );
  });

  it('shows the same step 2 for any email (no enumeration)', async () => {
    const { user } = renderApp('/forgot-password');
    await toStep2(user, 'nobody@example.com');
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument();
  });

  it('lets the user go back to a different email', async () => {
    const { user } = renderApp('/forgot-password');
    await toStep2(user);
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('counts down before Resend is available, then resends with a toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp('/forgot-password', {
      userEvent: { advanceTimers: vi.advanceTimersByTime },
    });
    await toStep2(user);
    expect(screen.getByRole('button', { name: /Resend code in (29|30)s/ })).toBeDisabled();
    await tick(6);
    expect(screen.getByRole('button', { name: /Resend code in 2[34]s/ })).toBeDisabled();
    await tick(25);
    const ready = screen.getByRole('button', { name: "Didn't get a code? Resend" });
    expect(ready).toBeEnabled();
    await user.click(ready);
    expect(await screen.findByText('New code sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code in 30s/ })).toBeDisabled();
  });
});
