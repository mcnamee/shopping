import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

test.describe('accessibility (axe) and tap targets at 390x844', () => {
  test('viewport is iPhone 13', async ({ page }) => {
    expect(page.viewportSize()?.width).toBe(390);
  });

  test('sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Trolley' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('sign-in with validation errors and banner', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByLabel('Password', { exact: true }).fill('WrongPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test('new password and forgot password screens', async ({ page }) => {
    await page.goto('/forgot-password');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByLabel('Password', { exact: true }).fill('TempPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('shell tabs', async ({ page }) => {
    await signInToShell(page);
    for (const path of ['/', '/search', '/recipes']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expectNoSeriousAxeViolations(page);
      await expectTapTargets(page);
    }
  });

  test('settings and sign-out sheet open', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
  });

  test('no-household state', async ({ page }) => {
    await signInToShell(page, 'nohousehold@example.com');
    await expect(
      page.getByRole('heading', { name: "Your account isn't set up yet" }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
});
