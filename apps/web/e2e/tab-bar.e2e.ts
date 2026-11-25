import { expect, test, type Locator, type Page } from '@playwright/test';
import { signInToShell } from './helpers';

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const ROOTS = [
  { label: 'Lists', path: '/' },
  { label: 'Products', path: '/search' },
  { label: 'Recipes', path: '/recipes' },
  { label: 'Settings', path: '/settings' },
];

test.describe('tab bar on tab roots only', () => {
  test.beforeEach(async ({ page }) => {
    await signInToShell(page);
  });

  test('visible on the four roots', async ({ page }) => {
    for (const { label, path } of ROOTS) {
      await nav(page).getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`));
      await expect(nav(page)).toBeVisible();
    }
  });

  test('hidden on pushed screens; back returns to the root with the bar', async ({ page }) => {
    const cases: { root: string; open: () => Promise<void>; back: RegExp }[] = [
      {
        root: '/',
        open: () => page.getByRole('link', { name: /Week of .*this week/ }).click(),
        back: /Back to lists/,
      },
      {
        root: '/recipes',
        open: () => page.getByRole('link', { name: /Lamb curry/ }).click(),
        back: /Back to Recipes/,
      },
      {
        root: '/',
        open: () => page.getByRole('link', { name: /^Templates/ }).click(),
        back: /Back to Lists/,
      },
      {
        root: '/settings',
        open: () => page.getByRole('link', { name: /Remembered units/ }).click(),
        back: /Back to settings/,
      },
    ];
    for (const c of cases) {
      await page.goto(c.root);
      await expect(nav(page)).toBeVisible();
      await c.open();
      await expect(nav(page)).toHaveCount(0);
      await page.getByRole('link', { name: c.back }).first().click();
      await expect(nav(page)).toBeVisible();
    }
  });

  test('template editor hides the bar', async ({ page }) => {
    await page.goto('/templates');
    await page
      .getByRole('link')
      .filter({ hasText: /items?/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/templates\/.+/);
    await expect(nav(page)).toHaveCount(0);
  });

  test('FAB and toast sit at the bottom safe area when the bar is hidden', async ({ page }) => {
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    await expect(nav(page)).toHaveCount(0);
    const vh = page.viewportSize()?.height ?? 0;
    const fab = page
      .getByRole('link', { name: 'Add items' })
      .or(page.getByRole('button', { name: 'Add items' }))
      .last();
    const fabBox = await box(fab);
    // 16px gap above the bottom edge (safe inset is 0 in the test browser), not above a 72px+ bar.
    expect(vh - (fabBox.y + fabBox.height)).toBeLessThanOrEqual(20);

    const row = page.getByRole('checkbox', { name: /Garlic per kg/ });
    const rb = await box(row);
    const y = rb.y + rb.height / 2;
    await page.mouse.move(rb.x + 330, y);
    await page.mouse.down();
    await page.mouse.move(rb.x + 200, y + 2, { steps: 6 });
    await page.mouse.move(rb.x + 40, y + 2, { steps: 6 });
    await page.mouse.up();
    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible();
    const t = await box(toast);
    // Sits above the FAB (72px lift) but nowhere near a 72px+ nav gap.
    expect(vh - (t.y + t.height)).toBeLessThan(12 + 72 + 4);
    expect(vh - (t.y + t.height)).toBeGreaterThanOrEqual(12);
  });
});
