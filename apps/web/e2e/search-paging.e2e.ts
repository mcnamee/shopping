import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  expectNoSeriousAxeViolations,
  expectTapTargets,
  signInToShell,
} from './helpers';

// QA additions (Stage 1): infinite scroll, load-more error, end of results, stale responses,
// image fallback stability, category paging. Uses the mock-only "__many" / "__manyfail" queries.

const field = (page: Page) => page.getByRole('searchbox', { name: 'Search products' });
const cards = (page: Page) => page.locator('main ul > li');

async function openSearch(page: Page) {
  await signInToShell(page);
  await page.goto('/search');
  await expect(field(page)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __mockApiLog: string[] }).__mockApiLog = [];
  });
}

const searchCalls = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __mockApiLog: string[] }).__mockApiLog.filter((c) =>
      c.includes('/products/search'),
    ),
  );

async function searchFor(page: Page, q: string) {
  await field(page).fill(q);
  await field(page).press('Enter');
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

test.describe('Infinite scroll', () => {
  test('first page is 24, scrolling loads the rest, no duplicates, end of results shown', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, '__many');
    await expect(cards(page)).toHaveCount(24);
    await expect(page.getByText('60 results')).toBeVisible();
    // Not at the end yet.
    await expect(page.getByText("That's everything for '__many'.")).toHaveCount(0);

    await expect(async () => {
      await scrollToBottom(page);
      await expect(cards(page)).toHaveCount(60, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });

    const end = page.getByText("That's everything for '__many'.");
    await expect(end).toBeVisible();
    await expect(
      page.getByRole('button', { name: "Can't find it? Add a custom item" }),
    ).toBeVisible();

    const titles = await page.getByRole('heading', { level: 3 }).allTextContents();
    expect(titles).toHaveLength(60);
    expect(new Set(titles).size).toBe(60); // no duplicates
    expect(titles).toEqual([...titles].sort()); // order stable, nothing re-sorted

    const calls = await searchCalls(page);
    expect(calls).toHaveLength(3); // 24 + 24 + 12
    expect(calls.every((c) => c.includes('limit=24'))).toBe(true);
    expect(calls[1]).toContain('cursor=');

    // No further requests at the end.
    await scrollToBottom(page);
    await page.waitForTimeout(600);
    expect(await searchCalls(page)).toHaveLength(3);

    await expectNoSeriousAxeViolations(page);
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);
  });

  test('a fresh query after paging starts again from page 1', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__many');
    await expect(cards(page)).toHaveCount(24);
    await scrollToBottom(page);
    await expect(cards(page)).not.toHaveCount(24);
    await searchFor(page, 'milk');
    await expect(page.getByRole('heading', { name: /milk/i, level: 3 }).first()).toBeVisible();
    expect(await page.getByRole('heading', { level: 3 }).count()).toBeLessThan(24);
  });
});

test.describe('Load-more error', () => {
  test('keeps the grid, shows inline error with Try again that recovers', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__manyfail');
    await expect(cards(page)).toHaveCount(24);
    await scrollToBottom(page);
    const msg = page.getByText("Couldn't load more.");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await expect(cards(page)).toHaveCount(24); // grid not cleared
    // The first-page error state must not appear.
    await expect(page.getByRole('heading', { name: "Couldn't load products" })).toHaveCount(0);
    // No retry storm: still a single failed attempt after a pause.
    await page.waitForTimeout(800);
    expect(await searchCalls(page)).toHaveLength(3); // page 1, then page 2 and its one auto-retry

    await expectNoSeriousAxeViolations(page);
    const retry = page.getByRole('button', { name: 'Try again' });
    const box = await retry.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);

    await retry.click();
    await expect(cards(page)).toHaveCount(48); // page 2 recovered
    // Page 3 also fails twice in the mock: recover again.
    await scrollToBottom(page);
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await expect(cards(page)).toHaveCount(48);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(cards(page)).toHaveCount(60);
    await expect(msg).toHaveCount(0);
    await expect(page.getByText("That's everything for '__manyfail'.")).toBeVisible();
  });
});

test.describe('Stale responses', () => {
  test('a slow earlier query never overwrites a newer one', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__slow'); // 3 s response
    await page.waitForTimeout(300);
    await searchFor(page, 'bananas');
    await expect(page.getByRole('heading', { name: /banana/i, level: 3 }).first()).toBeVisible();
    await page.waitForTimeout(3500); // let the stale response land
    await expect(page.getByRole('heading', { name: /banana/i, level: 3 }).first()).toBeVisible();
    await expect(field(page)).toHaveValue('bananas');
  });
});

test.describe('Images', () => {
  test('broken images show a placeholder and the layout does not shift; card name includes product', async ({
    page,
  }) => {
    await page.route(/aldi\.cx/, (route) => route.abort());
    await openSearch(page);
    await searchFor(page, 'milk');
    const first = cards(page).first();
    await expect(first).toBeVisible();
    await page.waitForTimeout(800);
    const before = await cards(page).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    await page.waitForTimeout(800);
    const after = await cards(page).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    expect(after).toEqual(before);
    // Placeholder letter is shown for the failed image.
    const title = (await first.getByRole('heading', { level: 3 }).textContent()) ?? '';
    await expect(
      first.getByText((title.trim()[0] ?? '?').toUpperCase(), { exact: true }).first(),
    ).toBeVisible();
    // Accessible name of the Add button carries the product name (img alt is "" by ruling).
    await expect(first.getByRole('button', { name: `Add ${title.trim()} to list` })).toBeVisible();
    await expect(
      first.getByRole('button', { name: `Add ${title.trim()} to a template` }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
});

test.describe('Keyboard and focus', () => {
  test('custom sheet traps focus and Escape returns focus to the opener', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'zzzzq');
    const opener = page.getByRole('button', { name: "Add 'zzzzq' as a custom item" });
    await opener.click();
    const sheet = page.getByRole('dialog', { name: 'Add a custom item' });
    await expect(sheet).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('note field enforces the 200-character limit', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    await page
      .getByRole('button', { name: /^Add .*2L to list$/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const note = dialog.getByRole('textbox', { name: /Note/ });
    await note.fill('x'.repeat(250));
    expect((await note.inputValue()).length).toBe(200);
    await expectNoSeriousAxeViolations(page);
  });

  test('tap on scrim closes the quantity modal without a toast', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    const add = page.getByRole('button', { name: /^Add .*2L to list$/ }).first();
    await add.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.mouse.click(195, 40);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('toast')).toBeHidden();
    await expect(add).toBeFocused();
  });
});

test.describe('Auth expiry', () => {
  test('a 401 from search signs the user out and returns to sign-in', async ({ page }) => {
    await openSearch(page);
    await searchFor(page, '__expired');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    // Protected routes stay protected.
    await page.goto('/search');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('Sheet gestures', () => {
  test('dragging the sheet header down dismisses; a short drag springs back; no toast', async ({
    page,
  }) => {
    await openSearch(page);
    await searchFor(page, 'milk');
    const add = page.getByRole('button', { name: /^Add .*2L to list$/ }).first();
    await add.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400); // let the slide-up animation finish
    const box = await dialog.boundingBox();
    if (!box) throw new Error('no sheet box');
    const x = box.x + box.width / 2;
    const y = box.y + 12; // drag handle zone

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 4 });
    await page.waitForTimeout(600); // slow release: no flick velocity
    await page.mouse.up();
    await expect(dialog).toBeVisible(); // under 25 percent: springs back

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + Math.round(box.height * 0.6), { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('toast')).toBeHidden();
    await expect(add).toBeFocused();
  });
});
