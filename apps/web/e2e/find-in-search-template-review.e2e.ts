import { expect, test } from '@playwright/test';
import { expectNoSeriousAxeViolations, expectTapTargets, signInToShell } from './helpers';

test('edit sheet product header opens Search with that product pinned first', async ({ page }) => {
  await signInToShell(page);
  await page.getByRole('link', { name: /Week of .*this week/ }).click();
  await page.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }).click();
  const dialog = page.getByRole('dialog', { name: 'Granny Smith Apples per kg' });
  const find = dialog.getByRole('button', { name: 'Find Granny Smith Apples per kg in Search' });
  await expectTapTargets(page);
  await find.click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/search\?q=Granny(\+|%20)Smith.*&pin=/);
  const first = page.getByRole('list').filter({ has: page.getByRole('button', { name: /^Add / }) });
  await expect(first.getByRole('listitem').first()).toContainText('Granny Smith Apples');
});

test('List options: Add from template reviews items, all ticked, then adds with Undo', async ({
  page,
}) => {
  await signInToShell(page);
  await page.getByRole('link', { name: /Week of .*this week/ }).click();
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'Add from template' }).click();
  await page
    .getByRole('dialog', { name: 'Add from template' })
    .getByRole('button', { name: /Tacos/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add Tacos' });
  const boxes = dialog.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await expect(boxes.nth(i)).toHaveAttribute('aria-checked', 'true');
  await expectNoSeriousAxeViolations(page);
  await dialog.getByRole('button', { name: `Add ${n} items` }).click();
  await expect(dialog).toBeHidden();
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveText(/Added/);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toHaveText(/Removed \d+ items/);
});
