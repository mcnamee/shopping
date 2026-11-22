// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { failNext, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const log = () => (globalThis as { __mockApiLog?: string[] }).__mockApiLog ?? [];
beforeEach(() => {
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog = [];
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

async function lists(opts?: Parameters<typeof renderMockApp>[1]) {
  const app = await renderMockApp('/', opts);
  await screen.findByRole('heading', { name: 'This week' }, { timeout: 3000 }).catch(() => null);
  return app;
}

describe('Lists tab', () => {
  it('shows this week as a card with progress and a Continue shopping button', async () => {
    await lists();
    const card = screen.getByRole('link', { name: /Week of .*, 6 of 21 ticked, this week/ });
    expect(card).toHaveAttribute('href', `/lists/${MOCK_SEED_IDS.thisWeekList}`);
    expect(screen.getByText('6/21 ticked')).toBeVisible();
    expect(screen.getByText('Continue shopping')).toBeVisible();
    expect(screen.getByRole('link', { name: /History/ })).toHaveAttribute('href', '/lists/history');
    expect(screen.getAllByRole('button', { name: 'New list' }).length).toBeGreaterThanOrEqual(1);
  });

  it('lists other active lists with their progress and a done check', async () => {
    const { user } = await lists();
    await user.click(screen.getAllByRole('button', { name: 'New list' })[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'New list' });
    await user.clear(within(sheet).getByLabelText('Name'));
    await user.type(within(sheet).getByLabelText('Name'), 'Birthday BBQ');
    await user.click(within(sheet).getByRole('button', { name: 'Create list' }));
    // Lands on the new (empty) list.
    expect(await screen.findByRole('heading', { level: 1, name: 'Birthday BBQ' })).toBeVisible();
    expect(await screen.findByText('Nothing on this list yet')).toBeVisible();
    await user.click(screen.getAllByRole('link', { name: 'Back to lists' })[0] as HTMLElement);
    const other = await screen.findByRole('link', { name: /^Birthday BBQ.*0 of 0 ticked$/ });
    expect(other).toHaveTextContent('0/0');
    // The flagged list stays this week's.
    expect(screen.getByRole('link', { name: /Week of .*this week/ })).toBeVisible();
  });

  it('shows the empty state and the New list button when there are no lists', async () => {
    const { user } = await renderMockApp(`/lists/${MOCK_SEED_IDS.thisWeekList}`);
    await screen.findByRole('heading', { level: 1, name: /Week of/ });
    await user.click(screen.getByRole('button', { name: 'List options' }));
    await user.click(await screen.findByRole('button', { name: 'Delete list' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete list' }),
    );
    expect(await screen.findByRole('heading', { name: 'No lists yet' })).toBeVisible();
    expect(
      screen.getByText("Start this week's shop from scratch or from a template."),
    ).toBeVisible();
    expect(await screen.findByRole('link', { name: 'History' })).toBeVisible();
  });

  it('shows an error with Try again', async () => {
    const { user } = await renderMockApp('/', { fail: { match: 'GET /api/lists', times: 2 } });
    expect(
      await screen.findByText("Couldn't load your lists", {}, { timeout: 4000 }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Week of/ })).toBeVisible();
  });
});

describe('New list sheet', () => {
  async function open() {
    const app = await lists();
    await app.user.click(screen.getAllByRole('button', { name: 'New list' })[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'New list' });
    return { ...app, sheet };
  }

  it('defaults the name to Week of <Monday> and unticks "this week" when one is flagged', async () => {
    const { sheet } = await open();
    expect((within(sheet).getByLabelText('Name') as HTMLInputElement).value).toMatch(
      /^Week of \d{1,2} [A-Z][a-z]{2}$/,
    );
    expect(
      within(sheet).getByRole('checkbox', { name: "Set as this week's list" }),
    ).not.toBeChecked();
  });

  it('From templates pre-ticks the weekly template and the button names it', async () => {
    const { user, sheet } = await open();
    await user.click(within(sheet).getByRole('radio', { name: 'From templates' }));
    expect(await within(sheet).findByRole('checkbox', { name: /Weekly basics/ })).toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: /Tacos/ })).not.toBeChecked();
    expect(within(sheet).getByRole('button', { name: 'Create from Weekly basics' })).toBeVisible();
    await user.click(within(sheet).getByRole('checkbox', { name: /Tacos/ }));
    expect(within(sheet).getByRole('button', { name: 'Create from 2 templates' })).toBeVisible();
    expect(
      within(sheet).getByText("Matching items are combined, so you won't get doubles."),
    ).toBeVisible();
  });

  it('creates from templates, merges, reports the counts and opens the new list', async () => {
    const { user, sheet } = await open();
    await user.clear(within(sheet).getByLabelText('Name'));
    await user.type(within(sheet).getByLabelText('Name'), 'Taco night');
    await user.click(within(sheet).getByRole('radio', { name: 'From templates' }));
    await user.click(await within(sheet).findByRole('checkbox', { name: /Tacos/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Create from 2 templates' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Taco night' })).toBeVisible();
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent(/^Created Taco night with \d+ items \(\d+ combined\)/);
    expect(log().some((c) => c.startsWith('POST /api/lists'))).toBe(true);
  });

  it('validates the name', async () => {
    const { user, sheet } = await open();
    await user.clear(within(sheet).getByLabelText('Name'));
    await user.click(within(sheet).getByRole('button', { name: 'Create list' }));
    expect(within(sheet).getByText('Enter a name for this list.')).toBeVisible();
    await user.type(within(sheet).getByLabelText('Name'), 'x'.repeat(61));
    await user.tab();
    expect(within(sheet).getByText('Keep it to 60 characters or fewer.')).toBeVisible();
  });

  it('shows the inline error and keeps the values when creating fails', async () => {
    const { user, sheet } = await open();
    failNext('POST /api/lists', 500);
    await user.click(within(sheet).getByRole('button', { name: 'Create list' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Couldn't create that list. Please try again.",
    );
    expect((within(sheet).getByLabelText('Name') as HTMLInputElement).value).toMatch(/^Week of/);
  });

  it('shows the limit state at 10 active lists', async () => {
    const { user, sheet } = await open();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    for (let i = 0; i < 9; i++) {
      await user.click(screen.getAllByRole('button', { name: 'New list' })[0] as HTMLElement);
      const s = await screen.findByRole('dialog', { name: 'New list' });
      await user.clear(within(s).getByLabelText('Name'));
      await user.type(within(s).getByLabelText('Name'), `List ${i}`);
      await user.click(within(s).getByRole('button', { name: 'Create list' }));
      await screen.findByRole('heading', { level: 1, name: `List ${i}` });
      await user.click(screen.getAllByRole('link', { name: 'Back to lists' })[0] as HTMLElement);
      await screen.findByRole('link', { name: new RegExp(`List ${i}`) });
    }
    await user.click(screen.getAllByRole('button', { name: 'New list' })[0] as HTMLElement);
    const blocked = await screen.findByRole('dialog', { name: 'New list' });
    expect(within(blocked).getByRole('alert')).toHaveTextContent(
      'You have 10 lists on the go, which is the most Trolley allows. Archive or delete one first.',
    );
    expect(within(blocked).getByRole('button', { name: 'OK' })).toBeVisible();
    expect(within(blocked).queryByLabelText('Name')).toBeNull();
  }, 60000);
});

describe('History', () => {
  it('lists archived lists newest first with the bought count, grouped by month', async () => {
    const { user } = await lists();
    await user.click(screen.getByRole('link', { name: /History/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    const rows = await screen.findAllByRole('link', { name: /finished .*bought$/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName(/11 of 12 bought/);
    expect(rows[1]).toHaveAccessibleName(/8 of 8 bought/);
    expect(within(rows[0] as HTMLElement).getByText(/11\/12 bought/)).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(/\w+ \d{4}/);
    await user.click(rows[0] as HTMLElement);
    expect(
      await screen.findByText('Archived and read-only. Nothing here can be changed.'),
    ).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Back to history' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  });

  it('shows an error with Try again', async () => {
    await renderMockApp('/lists/history', { fail: { match: 'GET /api/history', times: 2 } });
    expect(
      await screen.findByText("Couldn't load your history", {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
