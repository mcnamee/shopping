import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

async function searchFor(page: Page, q: string) {
  const field = page.getByRole('searchbox', { name: 'Search products' });
  await field.fill(q);
  await field.press('Enter');
}

test.describe('Templates tab', () => {
  test('list and editor pass axe, tap targets (44) and scroll checks', async ({ page }) => {
    await signInToShell(page);
    await nav(page, 'Templates');
    await expect(page.getByRole('link', { name: /Weekly basics/ })).toBeVisible();
    await expect(page.getByText('Weekly', { exact: true }).first()).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole('link', { name: /Tacos/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tacos' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Items in Tacos' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Edit Gourmet Tomatoes per kg' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
  });

  test('empty template, new template form and validation pass axe', async ({ page }) => {
    await signInToShell(page);
    await page.goto('/templates/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New template' })).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Enter a name for this template.')).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('unsaved name or type prompts before leaving via Search, back or tabs', async ({ page }) => {
    await signInToShell(page);
    await nav(page, 'Templates');
    await page.getByRole('link', { name: /Tacos/ }).click();
    await page.getByLabel('Name').fill('Taco Friday');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Lists' })
      .click();
    const sheet = page.getByRole('alertdialog', { name: 'Discard changes?' });
    await expect(sheet).toContainText("You've changed this template's name or type.");
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Taco Friday');
    await page.getByRole('link', { name: 'Back to templates' }).click();
    await sheet.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Taco Friday/ })).toBeVisible();
  });

  test('type filter chips, rename, delete item with Undo, delete template', async ({ page }) => {
    await signInToShell(page);
    await nav(page, 'Templates');
    await page.getByRole('radio', { name: 'Meal' }).click();
    await expect(page).toHaveURL(/type=meal/);
    await expect(page.getByRole('link', { name: /Weekly basics/ })).toHaveCount(0);
    await page.getByRole('link', { name: /Tacos/ }).click();

    await page.getByRole('button', { name: /Remove Gourmet Tomatoes/ }).click();
    await expect(page.getByText('Items (4)')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Items (5)')).toBeVisible();

    await page.getByLabel('Name').fill('Taco Tuesday');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('toast')).toContainText('Saved Taco Tuesday');

    await page.getByRole('button', { name: 'Delete template' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Taco Tuesday?' });
    await expectNoSeriousAxeViolations(page);
    await confirm.getByRole('button', { name: 'Delete template' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Tacos|Taco Tuesday/ })).toHaveCount(0);
  });

  test('Add to a list shows the merged count with Undo', async ({ page }) => {
    await signInToShell(page);
    await nav(page, 'Templates');
    await page.getByRole('link', { name: /Weekly basics/ }).click();
    await page.getByRole('button', { name: 'Add to a list' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add to a list' });
    await expect(sheet.getByRole('radio').first()).toContainText('This week');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await sheet.getByRole('button', { name: /^Add to Week of/ }).click();
    await expect(page.getByTestId('toast')).toContainText(
      /Added 10 items to Week of .*\(\d+ combined\)/,
    );
  });
});

test.describe('Quantity modal targets', () => {
  test('picker lists lists then templates, passes axe and tap targets; the button names the target', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.goto('/search');
    await searchFor(page, 'bananas');
    await page.getByRole('button', { name: 'Add Cavendish Bananas per kg to list' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await expect(dialog.getByRole('button', { name: /^Add to Week of/ })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await dialog.getByRole('button', { name: /^Adding to/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose where to add' });
    await expect(picker).toBeVisible();
    const rows = await picker.getByRole('radio').allTextContents();
    expect(rows[0]).toContain('Week of');
    expect(rows.at(-1)).toContain('Tacos');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await picker.getByRole('radio', { name: /Tacos/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'Cavendish Bananas per kg' }).getByRole('button', {
        name: 'Add to Tacos',
      }),
    ).toBeVisible();
  });

  test('J2: template -> new list -> add from search with a remembered unit -> shop all -> archived -> History', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInToShell(page);

    // 1. Create a template and add items through Search in template context.
    await nav(page, 'Templates');
    await page.getByRole('button', { name: 'New template' }).first().click();
    await page.getByLabel('Name').fill('Journey basics');
    await page.getByRole('button', { name: 'Add items' }).click();
    await expect(page.getByTestId('search-context')).toContainText(
      'Adding to template Journey basics',
    );
    await searchFor(page, 'bananas');
    const addBananas = page.getByRole('button', { name: 'Add Cavendish Bananas per kg to list' });
    await addBananas.click();
    let dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await expect(dialog.getByRole('button', { name: 'Add to Journey basics' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add to Journey basics' }).click();
    await expect(page.getByTestId('toast')).toContainText(
      'Added 1 kg Cavendish Bananas per kg to Journey basics',
    );
    // The same product and unit sums (D-046).
    await addBananas.click();
    dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await dialog.getByRole('button', { name: 'Add to Journey basics' }).click();
    await expect(page.getByTestId('toast')).toContainText(
      'Updated Cavendish Bananas per kg: now 2 kg in Journey basics',
    );
    await searchFor(page, 'rice');
    await page
      .getByRole('button', { name: /^Add .* to list$/ })
      .first()
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add to Journey basics' }).click();
    await expect(page.getByTestId('toast')).toContainText(/^Added/);
    await page.getByRole('link', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Journey basics' })).toBeVisible();
    await expect(page.getByText('Items (2)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Cavendish Bananas per kg' })).toContainText(
      '2 kg',
    );

    // 2. New list from that template.
    await nav(page, 'Lists');
    await page.getByRole('button', { name: 'New list' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New list' });
    await sheet.getByLabel('Name').fill('Journey list');
    await sheet.getByRole('radio', { name: 'From templates' }).click();
    await sheet.getByRole('checkbox', { name: /Weekly basics/ }).uncheck();
    await expect(sheet.getByRole('checkbox', { name: /Journey basics/ })).toBeChecked();
    await sheet.getByRole('button', { name: 'Create from Journey basics' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Journey list' })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(2);

    // 3. Add from Search with a unit override (Remember g).
    await page.getByRole('link', { name: 'Add items' }).click();
    await expect(page.getByTestId('search-context')).toContainText('Adding to Journey list');
    await searchFor(page, 'bananas');
    await page.getByRole('button', { name: 'Add Cavendish Bananas per kg to list' }).click();
    dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await dialog.getByRole('radio', { name: 'g', exact: true }).click();
    await expect(
      dialog.getByRole('checkbox', { name: /Remember g for this product/ }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Add to Journey list' }).click();
    await expect(page.getByTestId('toast')).toContainText(
      'Added 1000 g Cavendish Bananas per kg to Journey list',
    );
    // Next time it opens in g, on any phone.
    await page.getByRole('button', { name: 'Add Cavendish Bananas per kg to list' }).click();
    dialog = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
    await expect(dialog.getByRole('textbox', { name: 'Quantity in g' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('link', { name: 'Done' }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(3);

    // 4. Shop mode: tick everything; the list archives itself.
    const unticked = page.getByRole('checkbox', { checked: false });
    while ((await unticked.count()) > 0) await unticked.first().click();
    await expect(page.getByText('Shop complete! This list is archived.')).toBeVisible();

    // 5. It is in History, read-only.
    await page.getByRole('link', { name: 'Back to lists' }).click();
    await page.getByRole('link', { name: /History/ }).click();
    const entry = page.getByRole('link', { name: /Journey list\s*, finished .*3 of 3 bought/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(
      page.getByText('Archived and read-only. Nothing here can be changed.'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});
