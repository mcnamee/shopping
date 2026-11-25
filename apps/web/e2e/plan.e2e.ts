import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage6-shots';

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
    await page.screenshot({ path: `${SHOTS}/plan-week.png` });

    // Next week is empty: plan it.
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('button', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add this week's ingredients/ })).toBeHidden();

    for (const [day, name] of [
      ['Monday', 'Lamb curry'],
      ['Tuesday', 'Greek salad'],
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
    await page.getByRole('button', { name: 'Add lunch on Wednesday' }).click();
    let sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Something else' }).click();
    await sheet.getByRole('textbox', { name: 'What' }).fill('Leftovers');
    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await sheet.getByRole('button', { name: 'Add to plan' }).click();
    await expect(page.getByText('Leftovers')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: /Add this week's ingredients/ }).click();
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
