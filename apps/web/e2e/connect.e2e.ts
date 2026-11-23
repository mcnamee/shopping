import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage4-shots';

/** Submit the sign-in form already on screen (no navigation, so only the app carries state). */
async function submitSignIn(page: Page, email = 'alex@example.com', password = 'Password1') {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Stop external redirects leaving the app; resolves with the URL the browser was sent to. */
async function captureRedirect(page: Page, host: string): Promise<() => Promise<URL>> {
  let resolve!: (u: URL) => void;
  const got = new Promise<URL>((r) => (resolve = r));
  await page.route(`https://${host}/**`, (route) => {
    resolve(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>external</p>' });
  });
  // Wait for the browser to finish landing on the external page, so a following page.goto
  // doesn't race the in-flight navigation (QA D-1 flake).
  return async () => {
    const url = await got;
    await page.waitForURL((u) => u.host === host);
    return url;
  };
}

test.describe('Connect screen', () => {
  test('Allow sends the browser back to the client and adds a connected app', async ({ page }) => {
    await signInToShell(page);
    const redirect = await captureRedirect(page, 'claude.ai');
    await page.goto('/connect?request=mock-claude');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /Allow Claude to view and add to your Trolley lists/,
      }),
    ).toBeVisible();
    await expect(page.getByText("You'll be sent back to claude.ai")).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/connect.png` });
    await page.getByRole('button', { name: 'Allow' }).click();
    expect((await redirect()).searchParams.get('code')).toBe('mock-code');

    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /Connected apps/ })).toContainText('1 app');
  });

  test('Deny returns access_denied and adds nothing', async ({ page }) => {
    await signInToShell(page);
    const redirect = await captureRedirect(page, 'chatgpt.com');
    await page.goto('/connect?request=mock-chatgpt');
    await page.getByRole('button', { name: 'Deny' }).click();
    expect((await redirect()).searchParams.get('error')).toBe('access_denied');
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /Connected apps/ })).toContainText('None');
  });

  test('long client name wraps without horizontal scroll', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/connect?request=mock-long');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'A very long connector name',
    );
    await expectNoHorizontalScroll(page);
  });

  test('invalid link', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/connect?request=nope');
    await expect(page.getByText("This connection link isn't valid or has expired")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await page.getByRole('link', { name: 'Go to Trolley' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('signed out: sign in then return to /connect with the request preserved', async ({
    page,
  }) => {
    await page.goto('/connect?request=mock-claude');
    await expect(page).toHaveURL(/\/sign-in$/);
    await submitSignIn(page);
    await expect(page).toHaveURL(/\/connect\?request=mock-claude$/);
    await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
  });

  test('signed out with a temporary password: new password then back to /connect', async ({
    page,
  }) => {
    await page.goto('/connect?request=mock-chatgpt');
    await submitSignIn(page, 'new@example.com', 'TempPass1');
    await expect(page).toHaveURL(/\/new-password$/);
    await page.getByLabel('New password', { exact: true }).fill('Brand1Newpass');
    await page.getByLabel('Confirm new password').fill('Brand1Newpass');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page).toHaveURL(/\/connect\?request=mock-chatgpt$/);
    await expect(page.getByRole('heading', { level: 1, name: /Allow ChatGPT/ })).toBeVisible();
  });
});

test.describe('Connected apps', () => {
  test('empty state, then connect and disconnect', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/settings');
    await page.getByRole('link', { name: /Connected apps/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Connected apps' })).toBeVisible();
    await expect(page.getByText('No apps connected')).toBeVisible();
    await expect(page.getByTestId('mcp-url')).toHaveText('https://trolley.mcn.am/mcp');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await captureRedirect(page, 'claude.ai');
    await page.goto('/connect?request=mock-claude');
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(/claude\.ai/);
    await page.goto('/settings/connected-apps');
    const row = page.getByRole('listitem').filter({ hasText: 'Claude' });
    await expect(row).toContainText('never used');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);

    await page.getByRole('button', { name: 'Disconnect Claude' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Disconnect Claude?' })).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Claude disconnected')).toBeVisible();
    await expect(page.getByText('No apps connected')).toBeVisible();
  });
});

test.describe('Siri & Shortcuts', () => {
  test('creates a key, shows it once, then revokes it', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/settings');
    await page.getByRole('link', { name: /Siri & Shortcuts/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Siri & Shortcuts' })).toBeVisible();
    await page.getByLabel('Key name').fill("Matt's iPhone");
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('new-key').textContent()) ?? '';
    expect(key).toMatch(/^trl_/);
    await expect(page.getByText(/won.t be shown again/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Get .Add to Trolley./ })).toHaveAttribute(
      'href',
      /icloud\.com\/shortcuts\//,
    );
    await page.getByText('Or build it yourself').click();
    await expect(page.getByTestId('quick-auth-header')).toHaveText(`Bearer ${key}`);
    await expectNoSeriousAxeViolations(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(key)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Keys' })).toContainText("Matt's iPhone");
    await page.getByRole('button', { name: "Revoke Matt's iPhone" }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText("Matt's iPhone revoked")).toBeVisible();
    await expect(page.getByText('No keys yet.')).toBeVisible();
  });
});
