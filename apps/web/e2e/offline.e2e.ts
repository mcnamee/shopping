import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signInToShell } from './helpers';

const KEY = 'trolley.mock.stage2.v1';
const CACHE_KEY = 'trolley.offline.cache.v1';

const check = (page: Page, name: string | RegExp) => page.getByRole('checkbox', { name });
const unticked = (page: Page) => page.getByRole('checkbox', { checked: false });
const pill = (page: Page) => page.getByText(/^\d+ of \d+ (ticked|bought)$/);

async function openShop(page: Page) {
  await signInToShell(page);
  await page.getByRole('link', { name: /Week of .*this week/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
  await expect(check(page, /Granny Smith Apples/)).toBeVisible();
}

/** The dev server is unreachable while offline, so serve the app's own files through Playwright. */
async function serveAppWhileOffline(context: BrowserContext) {
  await context.route(
    (url) => url.hostname === 'localhost' && !url.pathname.startsWith('/api/'),
    async (route) => {
      try {
        await route.fulfill({ response: await route.fetch() });
      } catch {
        // The page or context went away mid-request (reload, end of test).
      }
    },
  );
}

async function waitForSavedCache(page: Page) {
  await expect
    .poll(() =>
      page.evaluate((k) => localStorage.getItem(k)?.includes('Granny Smith') ?? false, CACHE_KEY),
    )
    .toBe(true);
}

test.describe('Offline shop mode (B-006)', () => {
  test('ticks made offline queue, show as waiting, and sync on reconnect', async ({
    page,
    context,
  }) => {
    await openShop(page);
    await context.setOffline(true);
    await expect(page.getByText("Offline - ticks will sync when you're back online")).toBeVisible();

    await check(page, /Granny Smith Apples/).click();
    await check(page, /Garlic/).click();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await expect(pill(page)).toHaveText('8 of 21 ticked');
    await expect(
      page.getByText("Offline - ticks will sync when you're back online (2 waiting)"),
    ).toBeVisible();
    await expect(check(page, /Granny Smith Apples/).getByTestId('pending-sync')).toBeVisible();

    // Edits other than ticking stay disabled, with a clear message.
    await page.getByRole('button', { name: 'Edit Gourmet Tomatoes per kg' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText("You're offline. You can still tick");

    await context.setOffline(false);
    await expect(page.getByTestId('pending-sync')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText('Ticks synced');
    await expect(pill(page)).toHaveText('8 of 21 ticked');

    // Really on the server: a fresh load shows them ticked.
    await page.reload();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await expect(check(page, /Garlic/)).toHaveAttribute('aria-checked', 'true');
    await expect(pill(page)).toHaveText('8 of 21 ticked');
  });

  test('a queued tick survives a reload while offline', async ({ page, context }) => {
    await openShop(page);
    await waitForSavedCache(page);
    await serveAppWhileOffline(context);
    await context.setOffline(true);
    await check(page, /Granny Smith Apples/).click();
    await page.reload();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByText("Offline - ticks will sync when you're back online (1 waiting)"),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId('pending-sync')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText('Ticks synced');
  });

  test('a cold start offline shows the cached list instead of the sign-in screen', async ({
    page,
    context,
  }) => {
    await openShop(page);
    await waitForSavedCache(page);
    await serveAppWhileOffline(context);
    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveURL(/\/lists\//);
    await expect(page.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
    await expect(check(page, /Granny Smith Apples/)).toBeVisible();
    await expect(page.getByText("Offline - ticks will sync when you're back online")).toBeVisible();
    await check(page, /Granny Smith Apples/).click();
    await expect(check(page, /Granny Smith Apples/)).toHaveAttribute('aria-checked', 'true');
    await context.setOffline(false);
    await expect(page.getByTestId('toast')).toContainText('Ticks synced');
  });

  test('a cold start offline with nothing cached says it cannot reach Trolley and can retry', async ({
    page,
    context,
  }) => {
    await signInToShell(page);
    await page.evaluate(() => {
      localStorage.removeItem('trolley.offline.cache.v1');
      localStorage.removeItem('trolley.offline.user.v1');
    });
    await serveAppWhileOffline(context);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("Can't reach Trolley right now.")).toBeVisible();
    await expect(page).not.toHaveURL(/sign-in/);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });
});

test.describe('Shop mode extras', () => {
  test('ticking 30 rows in a row paints each in under 100 ms (B-013, E6)', async ({ page }) => {
    await openShop(page);
    await check(page, /Granny Smith Apples/).click(); // makes the mock persist its seed
    await check(page, /Granny Smith Apples/).click();
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key) as string);
      const hh = Object.values(s.households)[0] as {
        lists: {
          items: { id: string; ticked: boolean; product: { name: string } }[];
          status: string;
        }[];
      };
      const l = hh.lists.find((x) => x.status === 'active');
      if (!l) throw new Error('no active list');
      for (const it of [...l.items]) {
        const c = JSON.parse(JSON.stringify(it));
        c.id += 'x';
        c.product.name += ' 2';
        c.ticked = false;
        l.items.push(c);
      }
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    // The cached copy paints first; the refetch then brings the extra rows.
    await expect(page.getByRole('checkbox')).toHaveCount(42);
    expect(await unticked(page).count()).toBeGreaterThanOrEqual(31);

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
    for (let i = 0; i < 30; i++) await unticked(page).first().click();
    await expect
      .poll(() => page.evaluate(() => (window as never as { __paint: number[] }).__paint.length))
      .toBe(30);
    const paints = await page.evaluate(() => (window as never as { __paint: number[] }).__paint);
    expect(Math.max(...paints)).toBeLessThan(100);
  });

  test('a 401 from shop mode signs the user out and returns to sign-in (B-013)', async ({
    page,
  }) => {
    await openShop(page);
    await page.evaluate(
      () =>
        ((window as never as { __mockApiFail: unknown }).__mockApiFail = {
          match: 'PATCH /api/lists/',
          status: 401,
        }),
    );
    await check(page, /Granny Smith Apples/).click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('a long note shows in full on the shop row (B-012)', async ({ page }) => {
    await openShop(page);
    await check(page, /Granny Smith Apples/).click();
    await check(page, /Granny Smith Apples/).click();
    const note =
      'Granny Smiths only, firm and green, about the size of a tennis ball, not the bagged ones';
    await page.evaluate(
      ([key, text]) => {
        const s = JSON.parse(localStorage.getItem(key as string) as string);
        const hh = Object.values(s.households)[0] as {
          lists: { items: { product: { name: string }; note: string | null }[]; status: string }[];
        };
        const l = hh.lists.find((x) => x.status === 'active');
        const it = l?.items.find((i) => i.product.name.startsWith('Granny Smith'));
        if (it) it.note = text as string;
        localStorage.setItem(key as string, JSON.stringify(s));
      },
      [KEY, note],
    );
    await page.reload();
    const row = check(page, /Granny Smith Apples/);
    await expect(row).toContainText(note);
    const noteEl = row.getByText(note);
    const [lineHeight, height] = await noteEl.evaluate((el) => [
      parseFloat(getComputedStyle(el).lineHeight),
      el.getBoundingClientRect().height,
    ]);
    expect(height).toBeGreaterThan(lineHeight * 1.5); // wrapped onto a second line
    await expect(noteEl).not.toHaveCSS('text-overflow', 'ellipsis');
  });
});
