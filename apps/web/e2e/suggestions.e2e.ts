import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage3-shots';
const review = (page: Page) => page.getByRole('dialog', { name: 'Suggested items' });

test.describe('Suggest items', () => {
  test('Create and suggest: review sheet passes axe, tap targets and scroll; add and undo', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.getByRole('button', { name: 'New list' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New list' });
    await sheet.getByRole('radio', { name: 'Start with suggestions' }).click();
    await expect(sheet.getByText(/We'll look at what you usually buy/)).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await sheet.getByRole('button', { name: 'Create and suggest' }).click();

    const dialog = review(page);
    await expect(dialog).toBeVisible();
    const boxes = dialog.getByRole('checkbox');
    await expect(boxes.first()).toBeVisible();
    const n = await boxes.count();
    expect(n).toBeGreaterThan(2);
    await expect(boxes.first()).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText('Weekly', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Add ${n} items` })).toBeVisible();

    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/review.png` });

    // Untick one, bump another, add.
    await boxes.first().click();
    await dialog
      .getByRole('button', { name: /^Increase quantity for / })
      .nth(1)
      .click();
    await dialog.getByRole('button', { name: `Add ${n - 1} items` }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByTestId('toast');
    await expect(toast).toHaveText(new RegExp(`Added ${n - 1} items`));
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toHaveText(/Removed \d+ items/);
    await expect(page.getByRole('heading', { name: 'Nothing on this list yet' })).toBeVisible();
  });

  test('loading state: copy, axe, Cancel closes without adding', async ({ page }) => {
    await signInToShell(page);
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __mockApiDelay: unknown }).__mockApiDelay = {
        match: 'POST /api/lists/',
        ms: 5000,
      };
    });
    await page.getByRole('button', { name: 'List options' }).click();
    await page.getByRole('button', { name: 'Suggest items' }).click();
    const dialog = review(page);
    await expect(dialog.getByText('Looking at what you usually buy...')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/loading.png` });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});
