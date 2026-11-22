import { expect, test } from '@playwright/test';

// Uses the non-mock dev server (port 5198) so the app really fetches /config.json.
const REAL = 'http://localhost:5198';

test.describe('config.json loading', () => {
  test('HTTP 500 shows the friendly start-up error with a retry button', async ({ page }) => {
    await page.route('**/config.json', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await page.goto(`${REAL}/`);
    await expect(page.getByRole('heading', { name: "Trolley couldn't start" })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText("couldn't load the app's settings");
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText(/Cognito|userPool|undefined|TypeError/i)).toHaveCount(0);
  });

  test('network failure shows the start-up error', async ({ page }) => {
    await page.route('**/config.json', (route) => route.abort('failed'));
    await page.goto(`${REAL}/sign-in`);
    await expect(page.getByRole('heading', { name: "Trolley couldn't start" })).toBeVisible();
  });

  test('malformed or incomplete config shows the start-up error', async ({ page }) => {
    await page.route('**/config.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"region":"x"}' }),
    );
    await page.goto(`${REAL}/`);
    await expect(page.getByRole('heading', { name: "Trolley couldn't start" })).toBeVisible();
  });

  test('Try again reloads and recovers once config is available', async ({ page }) => {
    let fail = true;
    await page.route('**/config.json', (route) =>
      fail
        ? route.fulfill({ status: 500, body: '' })
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              region: 'ap-southeast-2',
              userPoolId: 'ap-southeast-2_TEST',
              userPoolClientId: 'testclient',
            }),
          }),
    );
    await page.goto(`${REAL}/sign-in`);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Trolley', level: 1 })).toBeVisible();
  });
});
