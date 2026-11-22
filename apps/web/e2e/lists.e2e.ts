import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const check = (page: Page, name: string | RegExp) => page.getByRole('checkbox', { name });
const unticked = (page: Page) => page.getByRole('checkbox', { checked: false });
const pill = (page: Page) => page.getByText(/^\d+ of \d+ (ticked|bought)$/);

async function openShop(page: Page) {
  await signInToShell(page);
  await page.getByRole('link', { name: /Week of .*this week/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
  await expect(check(page, /Granny Smith Apples/)).toBeVisible();
}

async function tickAll(page: Page) {
  while ((await unticked(page).count()) > 0) {
    await unticked(page).first().click();
  }
}

test.describe('Lists tab', () => {
  test('this week card, other lists and History pass axe, tap targets and scroll checks', async ({
    page,
  }) => {
    await signInToShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Lists' })).toBeVisible();
    const card = page.getByRole('link', { name: /Week of .*, 6 of 21 ticked, this week/ });
    await expect(card).toBeVisible();
    await expect(page.getByText('Continue shopping')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('New list sheet: from templates, merged counts, lands in shop mode', async ({ page }) => {
    await signInToShell(page);
    await page.getByRole('button', { name: 'New list' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New list' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('radio', { name: 'From templates' }).click();
    await expect(sheet.getByRole('checkbox', { name: /Weekly basics/ })).toBeChecked();
    await sheet.getByRole('checkbox', { name: /Tacos/ }).check();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await sheet.getByLabel('Name').fill('Taco night');
    await sheet.getByRole('button', { name: 'Create from 2 templates' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Taco night' })).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText(/Created Taco night with \d+ items/);
  });

  test('History lists finished shops and opens a read-only view', async ({ page }) => {
    await signInToShell(page);
    await page.getByRole('link', { name: /History/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    const rows = page.getByRole('link', { name: /finished .*bought$/ });
    await expect(rows).toHaveCount(2);
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await rows.first().click();
    await expect(
      page.getByText('Archived and read-only. Nothing here can be changed.'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'List options' })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Shop mode', () => {
  test('layout: groups in aisle order, tick rows are at least 56 px, axe, tap targets, scroll', async ({
    page,
  }) => {
    await openShop(page);
    const groups = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(groups[0]).toMatch(/^Fruit & Veg/);
    expect(groups.length).toBeGreaterThanOrEqual(10);
    for (const box of await check(page, /.*/).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(56);
    }
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    // Ticked rows stay readable too (contrast is part of the axe run above); check the sheet states.
    await page.getByRole('button', { name: 'List options' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
  });

  test('the whole row ticks; the count, progress bar and group header update; the row sinks', async ({
    page,
  }) => {
    await openShop(page);
    const fruit = page.getByRole('region', { name: /^Fruit & Veg/ });
    const names = () =>
      fruit
        .getByRole('checkbox')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(',')[0]));
    expect(await names()).toEqual([
      'Garlic per kg',
      'Gourmet Tomatoes per kg',
      'Granny Smith Apples per kg',
      'Cavendish Bananas per kg',
    ]);
    // Click the far right of the row body (not the pencil): still ticks.
    const row = check(page, /Granny Smith Apples/);
    const box = await row.boundingBox();
    if (!box) throw new Error('no row box');
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect(pill(page)).toHaveText('7 of 21 ticked');
    await expect(page.getByRole('progressbar', { name: 'Items ticked' })).toHaveAttribute(
      'aria-valuenow',
      '7',
    );
    await expect(row.getByText('Granny Smith Apples per kg')).toHaveCSS(
      'text-decoration-line',
      'line-through',
    );
    await expect
      .poll(names, { timeout: 3000 })
      .toEqual([
        'Garlic per kg',
        'Gourmet Tomatoes per kg',
        'Cavendish Bananas per kg',
        'Granny Smith Apples per kg',
      ]);
    // Untick restores its place.
    await row.click();
    await expect(pill(page)).toHaveText('6 of 21 ticked');
    await expect
      .poll(names, { timeout: 3000 })
      .toEqual([
        'Garlic per kg',
        'Gourmet Tomatoes per kg',
        'Granny Smith Apples per kg',
        'Cavendish Bananas per kg',
      ]);
  });

  test('ticking 15 items in a row paints each in under 100 ms (optimistic)', async ({ page }) => {
    await openShop(page);
    await page.evaluate(() => {
      const w = window as unknown as { __paint: number[] };
      w.__paint = [];
      document.addEventListener(
        'click',
        (e) => {
          const el = (e.target as HTMLElement).closest('[role=checkbox]');
          if (!el) return;
          const t0 = performance.now();
          const mo = new MutationObserver(() => {
            if (el.getAttribute('aria-checked') === 'true') {
              requestAnimationFrame(() => w.__paint.push(performance.now() - t0));
              mo.disconnect();
            }
          });
          mo.observe(el, { attributes: true });
        },
        true,
      );
    });
    for (let i = 0; i < 14; i++) await unticked(page).first().click();
    await expect
      .poll(() => page.evaluate(() => (window as never as { __paint: number[] }).__paint.length))
      .toBe(14);
    const paints = await page.evaluate(() => (window as never as { __paint: number[] }).__paint);
    expect(Math.max(...paints)).toBeLessThan(100);
  });

  test('ticking the last item archives the list with an Undo toast; Undo reopens it', async ({
    page,
  }) => {
    await openShop(page);
    await tickAll(page);
    await expect(page.getByText('Shop complete! This list is archived.')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('Shop complete - list archived');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: 'Add items' })).toBeVisible();
    await expect(pill(page)).toHaveText('21 of 21 ticked');
    await expect(page.getByText('Shop complete! This list is archived.')).toHaveCount(0);
    // It stays active until another tick completes it: untick, tick again archives once more.
    await check(page, /Garlic/).click();
    await expect(pill(page)).toHaveText('20 of 21 ticked');
    await check(page, /Garlic/).click();
    await expect(page.getByText('Shop complete! This list is archived.')).toBeVisible();
  });

  test('swipe left deletes with an Undo toast; the DELETE waits for the toast to end', async ({
    page,
  }) => {
    await openShop(page);
    await page.evaluate(() => ((window as never as { __mockApiLog: string[] }).__mockApiLog = []));
    const row = check(page, /Garlic per kg/);
    const box = await row.boundingBox();
    if (!box) throw new Error('no row box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 330, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, y + 2, { steps: 6 });
    await page.mouse.move(box.x + 40, y + 2, { steps: 6 });
    await page.mouse.up();
    await expect(check(page, /Garlic per kg/)).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText('Removed Garlic per kg');
    await expect(pill(page)).toHaveText('6 of 20 ticked');
    const deletes = () =>
      page.evaluate(
        () =>
          (window as never as { __mockApiLog: string[] }).__mockApiLog.filter((c) =>
            c.startsWith('DELETE'),
          ).length,
      );
    expect(await deletes()).toBe(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(check(page, /Garlic per kg/)).toBeVisible();
    await page.waitForTimeout(5600);
    expect(await deletes()).toBe(0);
    // And without Undo it is sent when the toast ends.
    const again = check(page, /Garlic per kg/);
    const b2 = await again.boundingBox();
    if (!b2) throw new Error('no row box');
    await page.mouse.move(b2.x + 330, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + 200, b2.y + b2.height / 2 + 2, { steps: 6 });
    await page.mouse.move(b2.x + 40, b2.y + b2.height / 2 + 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(deletes, { timeout: 8000 }).toBe(1);
  });

  test('the pencil opens the edit sheet; Save updates the row; stale edits show the latest', async ({
    page,
  }) => {
    await openShop(page);
    await page.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }).click();
    const dialog = page.getByRole('dialog', { name: 'Granny Smith Apples per kg' });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: '2 kg' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(check(page, /Granny Smith Apples per kg, 2 kg/)).toBeVisible();

    await page.getByRole('button', { name: 'Edit Granny Smith Apples per kg' }).click();
    await page.evaluate(
      () =>
        ((window as never as { __mockApiFail: unknown }).__mockApiFail = {
          match: 'PATCH /api/lists/',
          status: 409,
        }),
    );
    await dialog.getByRole('button', { name: '1 kg' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('toast')).toContainText(
      'Changed on another phone - showing latest',
    );
    await expect(dialog).toBeHidden();
  });

  test('failed ticks roll back with a toast; offline shows the banner', async ({
    page,
    context,
  }) => {
    await openShop(page);
    await page.evaluate(
      () =>
        ((window as never as { __mockApiFail: unknown }).__mockApiFail = {
          match: 'PATCH /api/lists/',
          status: 500,
        }),
    );
    await check(page, /Granny Smith Apples/).click();
    await expect(page.getByTestId('toast')).toContainText("Couldn't save. Check your connection.");
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'false');
    await context.setOffline(true);
    await expect(
      page.getByText("You're offline - ticks won't save until you're back"),
    ).toBeVisible();
    await check(page, /Granny Smith Apples/).click();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('toast')).toContainText("Couldn't save. Check your connection.");
    await context.setOffline(false);
  });

  test('options: rename, finish shop and delete', async ({ page }) => {
    await openShop(page);
    await page.getByRole('button', { name: 'List options' }).click();
    await page.getByRole('button', { name: 'Rename list' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename list' });
    await rename.getByLabel('Name').fill('Big shop');
    await rename.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Big shop' })).toBeVisible();

    await page.getByRole('button', { name: 'List options' }).click();
    await page.getByRole('button', { name: 'Finish shop' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Finish this shop?' });
    await expect(confirm).toContainText("15 items aren't ticked");
    await expectNoSeriousAxeViolations(page);
    await confirm.getByRole('button', { name: 'Finish and archive' }).click();
    await expect(page.getByText('Shop complete! This list is archived.')).toBeVisible();
    await page.getByRole('link', { name: 'Back to lists' }).click();
    await page.getByRole('link', { name: /History/ }).click();
    await expect(
      page.getByRole('link', { name: /Big shop\s*, finished .*6 of 21 bought/ }),
    ).toBeVisible();
  });
});

test.describe('two phones', () => {
  test('a tick on one phone shows on the other within a poll; adds appear after focus', async ({
    context,
    page,
  }) => {
    await openShop(page);
    const b = await context.newPage();
    await b.goto(page.url());
    await expect(b.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
    await expect(check(b, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'false');

    // Phone A ticks; phone B (shop mode, polling every 10 s) shows it within 11 s.
    await check(page, /Granny Smith Apples/).click();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await expect(check(b, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true', {
      timeout: 11_000,
    });
    await expect(pill(b)).toHaveText('7 of 21 ticked');

    // Phone B adds an item from search; A sees it on focus.
    await b.getByRole('link', { name: 'Add items' }).click();
    await expect(b.getByTestId('search-context')).toContainText('Adding to Week of');
    await b.getByRole('searchbox', { name: 'Search products' }).fill('lamb');
    await b.getByRole('searchbox', { name: 'Search products' }).press('Enter');
    await b
      .getByRole('button', { name: /^Add .* to list$/ })
      .first()
      .click();
    await b
      .getByRole('dialog')
      .getByRole('button', { name: /^Add to Week of/ })
      .click();
    await expect(b.getByTestId('toast')).toContainText(/^Added/);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('checkbox')).toHaveCount(22, { timeout: 5000 });
    await b.close();
  });
});
