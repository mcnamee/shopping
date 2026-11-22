import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('sign in', () => {
  test('shows the sign-in form with title and invite-only note', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page).toHaveTitle(/Trolley/);
    await expect(page.getByRole('heading', { name: 'Trolley', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeFocused();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByText('Trolley is invite-only')).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up|create account/i })).toHaveCount(0);
  });

  test('success lands on Lists', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible();
  });

  test('wrong password shows an inline alert and stays on sign-in', async ({ page }) => {
    await signIn(page, 'alex@example.com', 'WrongPass9');
    await expect(page.getByRole('alert')).toHaveText(
      'Incorrect email or password. Please try again.',
    );
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  });

  test('empty and invalid fields show validation messages', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText("That email address doesn't look right.")).toBeVisible();
    await page.getByLabel('Email').fill('alex@example.com');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your password.')).toBeVisible();
  });

  test('button is disabled with a busy label while submitting', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('alex@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    const button = page.getByRole('button', { name: /Sign(ing)? in/ });
    await button.click();
    await expect(page.getByRole('button', { name: /Signing in/ })).toBeDisabled();
  });

  test('password toggle reveals and hides the password', async ({ page }) => {
    await page.goto('/sign-in');
    const input = page.getByLabel('Password', { exact: true });
    await input.fill('Secret123');
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(input).toHaveAttribute('type', 'password');
  });

  for (const [email, message] of [
    ['locked@example.com', 'Too many attempts. Wait a few minutes, then try again.'],
    [
      'expired@example.com',
      'Your temporary password has expired. Ask your household admin for a new one.',
    ],
  ] as const) {
    test(`${email} shows its error banner`, async ({ page }) => {
      await signIn(page, email, 'Password1');
      await expect(page.getByRole('alert')).toHaveText(message);
    });
  }

  test('reset@example.com is routed to forgot password', async ({ page }) => {
    await signIn(page, 'reset@example.com', 'Password1');
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });

  test('session persists across reload', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible();
  });

  test('signed-in user visiting /sign-in is sent into the app', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/');
    await page.goto('/sign-in');
    await expect(page).toHaveURL('/');
  });
});

test.describe('new password flow', () => {
  test('temporary password -> new password -> Lists', async ({ page }) => {
    await signIn(page, 'new@example.com', 'TempPass1');
    await expect(page).toHaveURL(/\/new-password$/);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page.getByText('At least 8 characters')).toBeVisible();
    await expect(page.getByText('An uppercase letter (A-Z)')).toBeVisible();
    await expect(page.getByText('A lowercase letter (a-z)')).toBeVisible();
    await expect(page.getByText('A number (0-9)')).toBeVisible();

    await page.getByLabel('New password', { exact: true }).fill('Brand1Newpass');
    await page.getByLabel('Confirm new password').fill('Brand1Newpass');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible();
    await expect(page.getByText("Password saved. You're signed in.")).toBeVisible();
  });

  test('weak password and mismatch show inline errors', async ({ page }) => {
    await signIn(page, 'new@example.com', 'TempPass1');
    await page.getByLabel('New password', { exact: true }).fill('weak');
    await page.getByLabel('Confirm new password').fill('weak');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText("Your password doesn't meet all the rules below.")).toBeVisible();

    await page.getByLabel('New password', { exact: true }).fill('Brand1Newpass');
    await page.getByLabel('Confirm new password').fill('Different1Pass');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page).toHaveURL(/\/new-password$/);
  });

  test('direct visit without a challenge redirects to sign-in', async ({ page }) => {
    await page.goto('/new-password');
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('refreshing mid-challenge returns to sign-in with a timeout notice', async ({ page }) => {
    await signIn(page, 'new@example.com', 'TempPass1');
    await expect(page).toHaveURL(/\/new-password$/);
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByText('Your session timed out. Sign in again with your temporary password.'),
    ).toBeVisible();
  });
});

test.describe('forgot password', () => {
  test('request code, then reset with code and new password', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('alex@example.com');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByLabel('Email')).toHaveValue('alex@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('alex@example.com').first()).toBeVisible();
    await page.getByLabel('Code').fill('123456');
    await page.getByLabel('New password').fill('Fresh1Password');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('Password reset. Sign in with your new password.')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('alex@example.com');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  });

  test('wrong code and short code show inline errors', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('alex@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Code').fill('999999');
    await page.getByLabel('New password').fill('Fresh1Password');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(
      page.getByText("That code isn't right. Check your email and try again."),
    ).toBeVisible();

    await page.getByLabel('Code').fill('123');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('The code is 6 digits.')).toBeVisible();
  });

  test('step 1 validates the email', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
  });

  test('back link returns to sign-in', async ({ page }) => {
    await page.goto('/forgot-password');
    await page
      .getByRole('button', { name: /back to sign in/i })
      .or(page.getByRole('link', { name: /back to sign in/i }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
