import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const field = (page: Page) => page.getByRole('searchbox', { name: 'Search products' });

async function openSearch(page: Page, path = '/search') {
  await signInToShell(page);
  await page.goto(path);
  await expect(field(page)).toBeVisible();
}

async function searchFor(page: Page, q: string) {
  await field(page).fill(q);
  await field(page).press('Enter');
}

const addButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Add ${name} to list`, exact: true });

test.describe('Search tab', () => {
  test('initial state prompts to search and passes axe, tap targets and scroll checks', async ({
    page,
  }) => {
    await openSearch(page);
    await expect(page.getByRole('heading', { name: 'Find your ALDI items' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a custom item' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('searching "milk" shows ALDI milk in a 2-column grid; axe, tap targets, no h-scroll', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    await expect(page.getByRole('heading', { name: /milk/i, level: 3 }).first()).toBeVisible();
    await expect(page.getByText(/^\d+ results?$/)).toBeVisible();

    const cards = page.locator('main ul > li');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
    if (!a || !b) throw new Error('missing card boxes');
    expect(Math.abs(a.y - b.y)).toBeLessThan(2); // same row
    expect(b.x).toBeGreaterThan(a.x + a.width - 1); // second column
    if (c) expect(c.y).toBeGreaterThan(a.y + a.height - 1);

    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('typing sends one request per pause and ignores a single character', async ({ page }) => {
    await openSearch(page);
    // Mock mode answers inside the page; mock.ts logs each call when this array exists.
    await page.evaluate(() => {
      (window as unknown as { __mockApiLog: string[] }).__mockApiLog = [];
    });
    const searchCalls = () =>
      page.evaluate(() =>
        (window as unknown as { __mockApiLog: string[] }).__mockApiLog.filter((c) =>
          c.includes('/products/search'),
        ),
      );
    await field(page).click();
    await field(page).pressSequentially('m');
    await page.waitForTimeout(450);
    expect(await searchCalls()).toHaveLength(0);
    await field(page).pressSequentially('ilk', { delay: 60 });
    await expect(page.getByRole('heading', { name: /milk/i, level: 3 }).first()).toBeVisible();
    const calls = await searchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('q=milk');
  });

  test('category chips: selected state, browse A-Z, narrow, tap again for All, URL state', async ({
    page,
  }) => {
    await openSearch(page);
    const chips = page.getByRole('radiogroup', { name: 'Filter by category' });
    await expect(chips.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');

    await chips.getByRole('radio', { name: 'Fruit & Veg' }).click();
    await expect(chips.getByRole('radio', { name: 'Fruit & Veg' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText(/^Fruit & Veg, \d+ products$/)).toBeVisible();
    await expect(page).toHaveURL(/cat=fruit-veg/);
    const titles = await page.getByRole('heading', { level: 3 }).allTextContents();
    expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y)));

    await page.reload();
    await expect(chips.getByRole('radio', { name: 'Fruit & Veg' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText(/^Fruit & Veg, \d+ products$/)).toBeVisible();

    await chips.getByRole('radio', { name: 'Fruit & Veg' }).click();
    await expect(chips.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('heading', { name: 'Find your ALDI items' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The chips scroll inside their own row, not the page.
    const scrolls = await chips.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls).toBe(true);
  });

  test('state is restored from the URL and kept across tabs', async ({ page }) => {
    await openSearch(page, '/search?q=milk');
    await expect(field(page)).toHaveValue('milk');
    await expect(page.getByRole('heading', { name: /milk/i, level: 3 }).first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Settings' }).click();
    await nav.getByRole('link', { name: 'Products' }).click();
    await expect(page).toHaveURL(/q=milk/);
  });

  test('no results offers a custom item; axe and tap targets pass', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'zzzzq');
    await expect(page.getByRole('heading', { name: "No matches for 'zzzzq'" })).toBeVisible();
    await expect(page.getByRole('button', { name: "Add 'zzzzq' as a custom item" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('error state with Try again; axe passes', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__error');
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't load products" });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Something went wrong. Please try again.');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toBeVisible({ timeout: 10_000 }); // still failing: same state
    // Editing the query recovers.
    await searchFor(page, 'milk');
    await expect(page.getByRole('heading', { name: /milk/i, level: 3 }).first()).toBeVisible();
  });

  test('slow search shows skeleton cards', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__slow');
    await expect(page.locator('[aria-busy="true"] > li')).toHaveCount(6);
    await expect(page.getByText('Searching')).toBeAttached();
    await expectNoSeriousAxeViolations(page);
  });

  test('template icon opens the target picker with lists and templates', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    await page
      .getByRole('button', { name: /to a template$/ })
      .first()
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose where to add' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('radio', { name: /Weekly basics/ })).toBeVisible();
    await expect(picker.getByRole('radio', { name: /Week of/ })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test('opens as a dialog: focus in, trapped, axe and tap targets pass, Escape returns focus', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, 'bananas');
    const add = addButton(page, 'Cavendish Bananas per kg');
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Cavendish Bananas per kg' })).toBeFocused();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    // Focus trap: tabbing many times never leaves the dialog.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    // The page behind is inert.
    expect(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))).toBe(
      true,
    );

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
    await expect(page.getByTestId('toast')).toBeHidden();
  });

  test('kg: stepper by 0.25, presets, conversion to g, toast with the exact amount', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, 'bananas');
    await addButton(page, 'Cavendish Bananas per kg').click();
    const dialog = page.getByRole('dialog');
    const qty = dialog.getByRole('textbox', { name: /^Quantity/ });
    await expect(qty).toHaveValue('1');

    await dialog.getByRole('button', { name: 'Increase quantity' }).click();
    await dialog.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(qty).toHaveValue('1.5');
    await expect(dialog.getByRole('button', { name: '1.5 kg' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await dialog.getByRole('radio', { name: 'g', exact: true }).click();
    await expect(qty).toHaveValue('1500');
    await expect(qty).toHaveAccessibleName('Quantity in g');
    await expect(dialog.getByRole('button', { name: '1 kg' })).toBeVisible(); // 1000 g preset
    await dialog.getByRole('radio', { name: 'kg', exact: true }).click();
    await expect(qty).toHaveValue('1.5');

    await dialog.getByRole('button', { name: /^Add to Week of/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('toast')).toContainText(
      // The seeded this-week list already holds 1.5 kg of bananas, so this merges (D-046).
      /^Updated Cavendish Bananas per kg: now 3 kg in Week of \d+ \w+(Undo)?$/,
    );
    await expect(addButton(page, 'Cavendish Bananas per kg')).toHaveText('Added');
    await expect(addButton(page, 'Cavendish Bananas per kg')).toBeFocused();
  });

  test('validation: invalid entry shows the message and blocks Add', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'bananas');
    await addButton(page, 'Cavendish Bananas per kg').click();
    const dialog = page.getByRole('dialog');
    const qty = dialog.getByRole('textbox', { name: 'Quantity in kg' });
    await qty.fill('25');
    await qty.blur();
    await expect(dialog.getByText('Enter an amount from 0.05 to 20 kg.')).toBeVisible();
    await expect(qty).toHaveAttribute('aria-invalid', 'true');
    await expectNoSeriousAxeViolations(page);
    // aria-disabled stays clickable for real users; Playwright would wait, so force it.
    await dialog.getByRole('button', { name: /^Add to/ }).click({ force: true });
    await expect(dialog).toBeVisible();
    await expect(qty).toBeFocused();
    await qty.fill('1,5');
    await qty.press('Enter');
    await expect(qty).toHaveValue('1.5');
    await expect(dialog.getByText(/Enter an amount/)).toBeHidden();
  });

  test('each and pack: whole-number stepper, no presets, minimum 1', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    // A pack product (fixed 2 L milk).
    await page
      .getByRole('button', { name: /^Add .*2L to list$/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const qty = dialog.getByRole('textbox', { name: 'Quantity' });
    await expect(qty).toHaveValue('1');
    await expect(dialog.getByRole('group', { name: 'Quick amounts' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Decrease quantity' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(qty).toHaveValue('2');
    await dialog.getByRole('radio', { name: 'kg', exact: true }).click();
    await expect(qty).toHaveValue('1'); // different family: default for kg
    await dialog.getByRole('radio', { name: 'each' }).click();
    await expect(qty).toHaveValue('1');
  });

  test('seeded custom products cover kg, g, L and mL', async ({ page }) => {
    await openSearch(page);
    for (const [q, name, unit, def] of [
      ['lamb', 'Butcher lamb mince', 'kg', '1'],
      ['ham', 'Shaved leg ham', 'g', '500'],
      ['orange juice', 'Fresh orange juice', 'L', '1'],
      ['cold brew', 'Cold brew coffee concentrate', 'mL', '500'],
    ] as const) {
      await searchFor(page, q);
      await addButton(page, name).click();
      const dialog = page.getByRole('dialog', { name });
      await expect(dialog.getByRole('textbox', { name: `Quantity in ${unit}` })).toHaveValue(def);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });
});

test.describe('Custom product', () => {
  test('no results -> sheet -> save -> quantity modal -> toast -> appears with Custom badge', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, 'wagyu rump');
    await page.getByRole('button', { name: "Add 'wagyu rump' as a custom item" }).click();

    const sheet = page.getByRole('dialog', { name: 'Add a custom item' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Name')).toHaveValue('Wagyu rump');
    await expect(sheet.getByRole('heading', { name: 'Add a custom item' })).toBeFocused();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await sheet.getByLabel('Group').selectOption('meat-seafood');
    await expect(sheet.getByRole('radio', { name: 'kg', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await sheet.getByRole('button', { name: 'Save and choose quantity' }).click();

    const modal = page.getByRole('dialog', { name: 'Wagyu rump' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Custom item')).toBeVisible();
    await modal.getByRole('button', { name: '2 kg' }).click();
    await modal.getByRole('button', { name: /^Add to/ }).click();
    await expect(page.getByTestId('toast')).toContainText(/^Added 2 kg Wagyu rump to Week of/);

    // The new product now shows up in search with a Custom badge.
    const card = page.locator('li', { hasText: 'Wagyu rump' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Custom', { exact: true })).toBeVisible();
  });

  test('empty-state button opens an empty sheet with focus in the name field; validates', async ({
    page,
  }) => {
    await openSearch(page);
    await page.getByRole('button', { name: 'Add a custom item' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a custom item' });
    await expect(sheet.getByLabel('Name')).toBeFocused();
    await sheet.getByRole('button', { name: 'Save and choose quantity' }).click();
    await expect(sheet.getByText('Enter a name for this item.')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
  });

  test('unit helper copy follows the selection', async ({ page }) => {
    await openSearch(page);
    await page.getByRole('button', { name: 'Add a custom item' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a custom item' });
    await sheet.getByRole('radio', { name: 'L', exact: true }).click();
    await expect(sheet.getByText('Sold by volume, like milk.')).toBeVisible();
    await sheet.getByRole('radio', { name: 'pack' }).click();
    await expect(sheet.getByText(/Sold as a packet or bottle/)).toBeVisible();
  });
});
