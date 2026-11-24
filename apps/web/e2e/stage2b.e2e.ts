import { expect, test } from '@playwright/test';
import { signInToShell } from './helpers';

test.describe('Stage 2b', () => {
  test('edit sheet keeps the Note field visible with a short viewport (keyboard open)', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    await page.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }).click();
    const dialog = page.getByRole('dialog', { name: 'Granny Smith Apples per kg' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 390, height: 380 });
    const note = dialog.getByLabel(/note/i);
    await note.focus();
    await note.fill('Get the green ones');
    await expect(note).toBeVisible();
    // The sheet scrolls the focused field into view once the viewport settles.
    await expect
      .poll(async () => {
        const box = await note.boundingBox();
        return box !== null && box.height > 0 && box.y >= 0 && box.y + box.height <= 381;
      })
      .toBe(true);
    await page.screenshot({
      path: '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage2b-shots/keyboard-sheet.png',
    });
  });

  test('Regulars is a template type with its own badge; rows show thumbnails', async ({ page }) => {
    await signInToShell(page);
    await page.getByRole('link', { name: /^Templates/ }).click();
    await page.getByRole('button', { name: 'New template' }).first().click();
    await page.getByLabel('Name').fill('Top-ups');
    await page.getByRole('radio', { name: 'Regulars' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Top-ups' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to templates' }).click();
    await expect(page.getByRole('link', { name: /Top-ups/ })).toContainText('Regulars');
    await page.getByRole('link', { name: /Tacos/ }).click();
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Items in Tacos' })
        .locator('img, [data-testid=image-fallback]')
        .first(),
    ).toBeVisible();
  });
});
