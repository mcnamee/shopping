/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect, test, type Page } from '@playwright/test';
import { signInToShell } from './helpers';

const SHOTS =
  '/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage2-qa';
const KEY = 'trolley.mock.stage2.v1';

async function openShop(page: Page) {
  await signInToShell(page);
  await page.getByRole('link', { name: /Week of .*this week/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Week of/ })).toBeVisible();
}

test.describe('Stage 2 QA exploratory', () => {
  test('last row of a long list can be fully seen and tapped above the FAB and nav', async ({
    page,
  }) => {
    await openShop(page);
    await page.getByRole('checkbox').first().click(); // forces the mock to persist its seed
    await page.getByRole('checkbox').first().click();
    // Inflate the seeded list to ~60 items (clone with new ids/names).
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key) as string);
      const hh = Object.values(s.households)[0] as {
        lists: { items: Record<string, unknown>[]; status: string }[];
      };
      const l = hh.lists.find((x) => x.status === 'active')!;
      const base = [...l.items];
      for (let r = 1; r <= 2; r++)
        for (const it of base) {
          const c = JSON.parse(JSON.stringify(it));
          c.id = c.id + 'x' + r;
          c.product.name = c.product.name + ' ' + r;
          c.ticked = false;
          l.items.push(c);
        }
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    const rows = page.getByRole('checkbox');
    // The cached copy paints first; wait for the refetch to bring the cloned rows.
    await expect(rows).toHaveCount(63);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const last = rows.last();
    await page.screenshot({ path: SHOTS + '/a-long-list-bottom.png' });
    const box = (await last.boundingBox())!;
    const fab = (await page
      .getByRole('link', { name: 'Add items' })
      .or(page.getByRole('button', { name: 'Add items' }))
      .last()
      .boundingBox())!;
    console.log('LAST', JSON.stringify(box), 'FAB', JSON.stringify(fab));
    expect(box.y + box.height).toBeLessThanOrEqual(fab.y + 0.5);
    await last.click();
    await expect(last).toHaveAttribute('aria-checked', 'true');
  });

  test('redundant pack size on rows', async ({ page }) => {
    await openShop(page);
    await page.screenshot({ path: SHOTS + '/b-shop-top.png' });
    const metas = await page.evaluate(() =>
      [...document.querySelectorAll('[role=checkbox]')].map((e) =>
        (e as HTMLElement).innerText.replace(/\n/g, ' | '),
      ),
    );
    console.log('ROWS\n' + metas.join('\n'));
    const redundant = metas.filter((m) => /per kg.*per kg/i.test(m));
    console.log('REDUNDANT', JSON.stringify(redundant));
  });

  for (const vh of [664, 844]) {
    test(`quantity modal layout at 390x${vh}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: vh });
      await signInToShell(page);
      await page.goto('/search');
      const f = page.getByRole('searchbox', { name: 'Search products' });
      await f.fill('bananas');
      await f.press('Enter');
      await page
        .getByRole('button', { name: 'Add Cavendish Bananas per kg to list', exact: true })
        .click();
      const d = page.getByRole('dialog', { name: 'Cavendish Bananas per kg' });
      await expect(d).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: SHOTS + `/c-qty-modal-${vh}.png` });
      const m = await d.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const pos = (sel: RegExp) => {
          const t = [...el.querySelectorAll('label,button,textarea,input')].find((x) =>
            sel.test((x.getAttribute('aria-label') ?? '') + x.textContent),
          );
          return t ? Math.round(t.getBoundingClientRect().bottom) : null;
        };
        return {
          top: r.top,
          h: r.height,
          scrollH: el.scrollHeight,
          client: el.clientHeight,
          noteBottom: pos(/Note/),
          addingTo: pos(/Adding to|Add to/),
          confirm: pos(/^Add to|Add \d/),
        };
      });
      console.log('QTY@' + vh, JSON.stringify(m));
      // edit sheet
      await page.keyboard.press('Escape');
      await page.goto('/');
      await page.getByRole('link', { name: /Week of .*this week/ }).click();
      await page.getByRole('button', { name: /^Edit Gourmet Tomatoes/ }).click();
      const e = page.getByRole('dialog');
      await expect(e).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: SHOTS + `/c-edit-sheet-${vh}.png` });
      const em = await e.evaluate((el) => ({
        h: el.getBoundingClientRect().height,
        scrollH: el.scrollHeight,
        client: el.clientHeight,
      }));
      console.log('EDIT@' + vh, JSON.stringify(em));
    });
  }

  test('concurrent ticking from two pages in one context keeps both ticks', async ({ context }) => {
    const a = await context.newPage();
    await openShop(a);
    const b = await context.newPage();
    await b.goto(a.url());
    await expect(b.getByRole('checkbox').first()).toBeVisible();
    const names = await a
      .getByRole('checkbox', { checked: false })
      .evaluateAll((els) => els.slice(0, 2).map((e) => e.getAttribute('aria-label') ?? ''));
    await Promise.all([
      a.getByRole('checkbox', { checked: false }).first().click(),
      b.getByRole('checkbox', { checked: false }).nth(1).click(),
    ]);
    await a.reload();
    await b.reload();
    for (const p of [a, b]) {
      console.log('PILL', await p.getByText(/^\d+ of \d+ ticked$/).innerText());
    }
    console.log('TICKED', names.join(' / '));
  });

  test('delete then leave screen before toast ends still deletes', async ({ page }) => {
    await openShop(page);
    const first = page.getByRole('checkbox').first();
    const label = await first.getAttribute('aria-label');
    const before = await page.getByRole('checkbox').count();
    await page
      .getByRole('button', { name: /^Edit / })
      .first()
      .click();
    await page
      .getByRole('button', { name: /Delete|Remove/ })
      .first()
      .click();
    const conf = page.getByRole('button', { name: /^(Delete|Remove)$/ });
    if (await conf.count()) await conf.first().click();
    await page.getByRole('link', { name: 'Back to lists' }).click();
    await page.waitForTimeout(7000);
    await page.getByRole('link', { name: /Week of .*this week/ }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(before - 1);
    console.log('DELETED', label);
  });
});
