import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage6-shots';

/** Weekday name of Sydney's today plus n days (the plan range starts today). */
const dayName = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(
    new Date(),
  );
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(d);
};

test.describe('Meal plan', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('plan a week with two recipes and Leftovers, then add the week ingredients to the list', async ({
    page,
  }) => {
    await signInToShell(page);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Recipes' })
      .click();
    await page.getByRole('button', { name: 'Plan' }).click();

    // The seeded sample week is there: check the layout first.
    await expect(page.getByRole('button', { name: /^Lamb curry.*Actions/ })).toBeVisible();
    await expect(page.getByText('Today', { exact: true })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
    // Edit a free-text entry (text, note, meal, day) with the date input inside the sheet.
    await page.getByRole('button', { name: /^Leftovers.*Actions/ }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByLabel('What')).toHaveValue('Leftovers');
    await expectNoHorizontalScroll(page);
    await edit.getByLabel('What').fill('Soup');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: /^Soup.*Actions/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/plan-week.png` });

    // The next 7 days are empty: plan it.
    await page.getByRole('button', { name: 'Next 7 days' }).click();
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Add ingredients for these 7 days/ }),
    ).toBeHidden();

    for (const [day, name] of [
      [dayName(7), 'Lamb curry'],
      [dayName(8), 'Greek salad'],
    ] as const) {
      await page.getByRole('button', { name: `Add dinner on ${day}` }).click();
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('radio', { name: new RegExp(name) }).click();
      await sheet.getByRole('button', { name: 'Add to plan' }).click();
      await expect(sheet).toBeHidden();
      await expect(
        page.getByRole('button', { name: new RegExp(`^${name}.*Actions`) }),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: `Add lunch on ${dayName(9)}` }).click();
    let sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Something else' }).click();
    await sheet.getByRole('textbox', { name: 'What' }).fill('Leftovers');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await sheet.getByRole('button', { name: 'Add to plan' }).click();
    await expect(page.getByText('Leftovers', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: /Add ingredients for these 7 days/ }).click();
    sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('region', { name: 'Lamb curry' })).toBeVisible();
    await expect(sheet.getByRole('region', { name: 'Greek salad' })).toBeVisible();
    await expect(sheet.getByText(/Finding ALDI products|Loading recipes/)).toBeHidden();
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOTS}/plan-ingredients-sheet.png` });
    await sheet.getByRole('button', { name: /^Add \d+ to Week of/ }).click();
    await expect(page.getByText(/^Added \d+ to Week of/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText(/^Removed \d+ items?/)).toBeVisible();
  });
});

test.describe('Add to plan date input', () => {
  for (const width of [360, 390]) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInToShell(page);
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Recipes' })
        .click();
      await page
        .getByRole('link', { name: /Lamb curry/ })
        .first()
        .click();
      await page
        .getByRole('button', { name: /Add to plan/ })
        .first()
        .click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByLabel('Day')).toBeVisible();
      await expectNoHorizontalScroll(page);
      const box = await sheet.getByLabel('Day').boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    });
  }
});
