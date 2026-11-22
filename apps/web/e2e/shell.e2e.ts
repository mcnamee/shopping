import { expect, test } from '@playwright/test';
import { EMAIL, expectNoHorizontalScroll, signInToShell } from './helpers';

const TABS = [
  { label: 'Lists', path: '/', heading: 'Lists are coming soon' },
  { label: 'Templates', path: '/templates', heading: 'Templates are coming soon' },
] as const;

test.describe('signed-in shell', () => {
  test.beforeEach(async ({ page }) => {
    await signInToShell(page);
  });

  test('bottom nav has four links; the active tab carries aria-current', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Lists', 'Search', 'Templates', 'Settings']);
    for (const name of ['Lists', 'Search', 'Templates', 'Settings']) {
      await nav.getByRole('link', { name }).click();
      await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    }
  });

  test('placeholder tabs show their empty states', async ({ page }) => {
    for (const { label, path, heading } of TABS) {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: label })
        .click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('nav is fixed to the bottom of the viewport', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    const box = await nav.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('missing nav box or viewport');
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
  });

  test('deep link refresh keeps you on the page', async ({ page }) => {
    await page.goto('/templates');
    await page.reload();
    await expect(page).toHaveURL('/templates');
    await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Templates' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('unknown route falls back to Lists', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL('/');
  });

  test('no horizontal scroll on any tab', async ({ page }) => {
    for (const path of ['/', '/search', '/templates', '/settings']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });

  test('settings shows email, version, and sign out confirm can be cancelled', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Signed in as')).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
    await expect(page.getByText(/^Trolley v\d/)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Sign out of Trolley?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL('/settings');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('confirming sign out returns to sign-in and protects routes', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe('signed out', () => {
  for (const path of ['/', '/search', '/templates', '/settings']) {
    test(`deep link ${path} redirects to sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole('heading', { name: 'Trolley', level: 1 })).toBeVisible();
    });
  }

  test('after sign-in from a deep link the user returns to that page', async ({ page }) => {
    await page.goto('/templates');
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/templates');
  });
});

test.describe('no household', () => {
  test('shows the account-not-set-up state, settings still reachable', async ({ page }) => {
    await signInToShell(page, 'nohousehold@example.com');
    await expect(
      page.getByRole('heading', { name: "Your account isn't set up yet" }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Search' })
      .click();
    await expect(
      page.getByRole('heading', { name: "Your account isn't set up yet" }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByText('nohousehold@example.com')).toBeVisible();
  });
});
