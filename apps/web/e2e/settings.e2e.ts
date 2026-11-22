import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const names = (page: Page) =>
  page
    .getByRole('list', { name: 'Aisle order' })
    .getByRole('listitem')
    .evaluateAll((els) => els.map((el) => el.textContent?.replace(/^\d+/, '').trim()));

async function openAisle(page: Page) {
  await signInToShell(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: /Aisle order/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Aisle order' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Aisle order' })).toBeVisible();
}

test.describe('Settings', () => {
  test('Shopping section links show their values and pass axe, tap targets and scroll', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.goto('/settings');
    const aisle = page.getByRole('link', { name: /Aisle order/ });
    await expect(aisle).toContainText('ALDI order');
    await expect(page.getByRole('link', { name: /Remembered units/ })).toContainText('None yet');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('Aisle order: arrows, auto-save, persists, shop mode follows, reset with Undo', async ({
    page,
  }) => {
    await openAisle(page);
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    const before = await names(page);
    expect(before).toHaveLength(15);
    expect(before[0]).toBe('Fruit & Veg');

    await page.getByRole('button', { name: 'Move Bakery up' }).click();
    await expect(page.getByRole('button', { name: 'Move Bakery down' })).toBeFocused();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 4000 });
    expect((await names(page))[0]).toBe('Bakery');

    await page.reload();
    await expect(page.getByRole('list', { name: 'Aisle order' })).toBeVisible();
    expect((await names(page))[0]).toBe('Bakery');
    await expect(page.getByRole('button', { name: 'Reset to ALDI order' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    // Shop mode follows it.
    await page.goto('/');
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('Bakery');
    await page.goBack();
    await page.goBack();
    await expect(page.getByRole('list', { name: 'Aisle order' })).toBeVisible();

    await page.getByRole('button', { name: 'Reset to ALDI order' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reset the aisle order?' });
    await expectNoSeriousAxeViolations(page);
    await confirm.getByRole('button', { name: 'Reset order' }).click();
    await expect.poll(() => names(page)).toEqual(before);
    await expect(page.getByTestId('toast')).toContainText('Aisle order reset to ALDI order');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await names(page))[0]).toBe('Bakery');
  });

  test('Aisle order: drag the handle', async ({ page }) => {
    await openAisle(page);
    const handle = page.getByTestId('drag-fruit-veg');
    const box = await handle.boundingBox();
    if (!box) throw new Error('no handle');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 70, { steps: 5 });
    await page.mouse.move(x, y + 135, { steps: 5 });
    await page.mouse.up();
    expect((await names(page)).slice(0, 3)).toEqual(['Bakery', 'Meat & Seafood', 'Fruit & Veg']);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 4000 });
  });

  test('Aisle order: a failed save rolls back with the error banner', async ({ page }) => {
    await openAisle(page);
    await page.evaluate(
      () =>
        ((window as never as { __mockApiFail: unknown }).__mockApiFail = {
          match: 'PUT /api/settings/aisle-order',
          status: 500,
        }),
    );
    await page.getByRole('button', { name: 'Move Bakery up' }).click();
    await expect(page.getByRole('alert')).toContainText(
      "Couldn't save the new order. Please try again.",
    );
    expect((await names(page))[0]).toBe('Fruit & Veg');
    await expectNoSeriousAxeViolations(page);
  });

  test('Remembered units: empty state, remembered from the modal, forget with Undo', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.goto('/settings/units');
    await expect(page.getByRole('heading', { name: 'No remembered units' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await page.goto('/search');
    const field = page.getByRole('searchbox', { name: 'Search products' });
    await field.fill('bananas');
    await field.press('Enter');
    await page.getByRole('button', { name: 'Add Cavendish Bananas per kg to list' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await dialog.getByRole('radio', { name: 'g', exact: true }).click();
    await dialog.getByRole('button', { name: /^Add to/ }).click();
    await expect(page.getByTestId('toast')).toContainText('Added 1000 g');

    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /Remembered units/ })).toContainText('1 product');
    await page.getByRole('link', { name: /Remembered units/ }).click();
    await expect(page.getByText('Opens in g (usually kg)')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.getByRole('button', { name: /^Forget g for Cavendish Bananas/ }).click();
    await expect(page.getByTestId('toast')).toContainText('will open in kg again');
    await expect(page.getByRole('heading', { name: 'No remembered units' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Opens in g (usually kg)')).toBeVisible();
  });
});
