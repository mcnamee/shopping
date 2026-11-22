import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const EMAIL = 'alex@example.com';
export const PASSWORD = 'Password1';

export async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInToShell(page: Page, email = EMAIL) {
  await signIn(page, email);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** Fails on serious/critical axe violations (WCAG 2 A/AA + best practice). */
export async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every visible interactive element must be at least 44x44 CSS px (excluding inline text links in prose). */
export async function expectTapTargets(page: Page, min = 44) {
  const small = await page.evaluate((minSize) => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type=hidden]), select, textarea, [role=button]',
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      if (r.width < minSize - 0.5 || r.height < minSize - 0.5) {
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName;
        out.push(
          `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return out;
  }, min);
  expect(small).toEqual([]);
}
