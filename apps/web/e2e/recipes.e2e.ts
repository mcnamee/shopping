import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage5-shots';
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

// 1x1 transparent PNG: the browser resizes it to a JPEG and a thumb like a real photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Recipes', () => {
  for (const width of [360, 390]) {
    test(`bottom nav labels fit on one line at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInToShell(page);
      const links = nav(page).getByRole('link');
      await expect(links).toHaveCount(4);
      const fit = await links.evaluateAll((els) =>
        els.map((a) => {
          const label = a.querySelector('span:last-child') as HTMLElement;
          const r = label.getBoundingClientRect();
          const box = a.getBoundingClientRect();
          return {
            text: label.textContent,
            clipped: label.scrollWidth > label.clientWidth + 0.5,
            oneLine: r.height < 20,
            inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
          };
        }),
      );
      for (const f of fit)
        expect(f, f.text ?? '').toMatchObject({ clipped: false, oneLine: true, inside: true });
      await expectNoHorizontalScroll(page);
    });
  }

  test('list, detail, editor and add-to-list sheet pass axe, tap targets and scroll checks', async ({
    page,
  }) => {
    await signInToShell(page);
    await nav(page).getByRole('link', { name: 'Recipes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lamb curry/ })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole('link', { name: /Lamb curry/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/recipe-detail.png` });

    await page.getByRole('button', { name: 'Add to list' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('checkbox')).toHaveCount(9);
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOTS}/add-to-list-sheet.png` });
    await sheet.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit recipe' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('create a recipe, add its ingredients to this week, then tick them in shop mode', async ({
    page,
  }) => {
    await signInToShell(page);
    await page.goto('/recipes/new');
    await page.getByLabel('Title').fill('Tomato soup');
    await page.getByLabel('Categories').fill('Soup,');
    await page
      .getByLabel('Ingredients', { exact: true })
      .fill('# Soup\n6 ripe tomatoes\n1 onion, diced\nFresh basil');
    await page
      .getByLabel('Method', { exact: true })
      .fill('Roast the tomatoes.\n\nBlend with the onion.');
    await page
      .getByLabel('Choose photo')
      .setInputFiles({ name: 'soup.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Recipe photo preview')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Tomato soup' })).toBeVisible();
    await expect(page.getByText('6 ripe tomatoes')).toBeVisible();
    await page.getByRole('button', { name: 'Add to list' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Add 3 to Week of/ })
      .click();
    await expect(page.getByText(/^Added 3 to Week of/)).toBeVisible();

    await page.goto('/');
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    const tomatoes = page.getByRole('checkbox', { name: '6 ripe tomatoes' });
    await expect(tomatoes).toBeVisible();
    await expect(tomatoes).toContainText('From Tomato soup');
    await tomatoes.click();
    await expect(tomatoes).toHaveAttribute('aria-checked', 'true');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('import a Mela zip: one new recipe with a photo, one duplicate skipped', async ({
    page,
  }) => {
    await signInToShell(page);
    await nav(page).getByRole('link', { name: 'Recipes' }).click();
    await page
      .getByTestId('mela-file-input')
      .setInputFiles(
        fileURLToPath(new URL('../src/recipes/fixtures/two-recipes.melarecipes', import.meta.url)),
      );
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Found 2 recipes')).toBeVisible();
    await expect(sheet.getByText('Already in Trolley - will skip')).toBeVisible();
    await expect(sheet.getByRole('checkbox', { name: /Fixture lemon pasta/ })).toBeChecked();
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOTS}/mela-preview.png` });
    await sheet.getByRole('button', { name: 'Import 1' }).click();
    await expect(sheet.getByText('1 recipe imported')).toBeVisible();
    await expect(sheet.getByText('Skipped duplicates: 1')).toBeVisible();
    await expect(sheet.getByText('Failed: 0')).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('link', { name: /Fixture lemon pasta/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fixture lemon pasta' }),
    ).toBeVisible();
    await expect(
      page.locator('img[src*="/media/"], img[src^="data:"], img[src^="blob:"]').first(),
    ).toBeVisible();
  });

  // Local-only check against a real Mela export (third-party content, never committed).
  const REAL =
    '/root/.claude/uploads/8e252ed6-4540-5359-9d43-d654ea5e1540/2da9fcaf-Aussie-style_beef_and_salad_tacos_recipe.melarecipe';
  test('a real Mela export imports with its photo resized (skipped when absent)', async ({
    page,
  }) => {
    test.skip(!existsSync(REAL), 'real export not present');
    await signInToShell(page);
    await nav(page).getByRole('link', { name: 'Recipes' }).click();
    await page.getByTestId('mela-file-input').setInputFiles(REAL);
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Import 1' }).click();
    await expect(sheet.getByText('1 recipe imported')).toBeVisible();
    await expect(sheet.getByText("Photo couldn't be read")).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('link', { name: /Aussie-style beef/ }).click();
    await expect(page.getByText('Serves 10')).toBeVisible();
    await expect(page.getByText('**')).toHaveCount(0);
  });
});
