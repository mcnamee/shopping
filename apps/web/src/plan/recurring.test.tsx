// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { addDays, nextWeekdayOnOrAfter, storeToday } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTickQueue } from '../offline/tickQueue';
import { renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

beforeEach(() => {
  vi.stubGlobal('__mockApiDelay', null);
  localStorage.clear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetTickQueue();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

const FRIDAY = () => nextWeekdayOnOrAfter(storeToday(), 5);
const THURSDAY = () => nextWeekdayOnOrAfter(storeToday(), 4);
const dayName = (date: string) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
const dayCard = (date: string) =>
  screen.findByRole('listitem', { name: new RegExp(`^${dayName(date)}`) });

async function openPlan() {
  localStorage.setItem('trolley.recipes.view', 'plan');
  const app = await renderMockApp('/recipes');
  await screen.findByRole('list', { name: 'Days' }, { timeout: 3000 });
  return app;
}

describe('recurring meals on the plan', () => {
  it('shows seeded occurrences with a repeat marker', async () => {
    await openPlan();
    const friday = await dayCard(FRIDAY());
    expect(await within(friday).findByText('Pizza', {}, { timeout: 3000 })).toBeVisible();
    expect(within(friday).getByRole('button', { name: /^Pizza.*Repeats.*Actions/ })).toBeVisible();
    const thursday = await dayCard(THURSDAY());
    expect(await within(thursday).findByText('Chicken wraps')).toBeVisible();
    // Dinner is taken on Friday, so only the other meals offer "+".
    expect(
      within(friday).queryByRole('button', { name: `Add dinner on ${dayName(FRIDAY())}` }),
    ).toBeNull();
  });

  it('skips this week with Undo', async () => {
    const { user } = await openPlan();
    const friday = await dayCard(FRIDAY());
    await user.click(await within(friday).findByRole('button', { name: /^Pizza/ }));
    const dialog = await screen.findByRole('dialog');
    for (const name of ['Skip this week', 'Change this week only', 'Edit recurring meal']) {
      expect(within(dialog).getByRole('button', { name })).toBeVisible();
    }
    await user.click(within(dialog).getByRole('button', { name: 'Skip this week' }));
    await waitFor(() => expect(within(friday).queryByText('Pizza')).toBeNull());
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await within(friday).findByText('Pizza')).toBeVisible();
  });

  it('changes this week only: skips the occurrence and adds a prefilled one-off', async () => {
    const { user } = await openPlan();
    const friday = await dayCard(FRIDAY());
    await user.click(await within(friday).findByRole('button', { name: /^Pizza/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Change this week only',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const what = within(dialog).getByLabelText('What');
    expect(what).toHaveValue('Pizza');
    await user.clear(what);
    await user.type(what, 'Curry night');
    await user.click(within(dialog).getByRole('button', { name: 'Save for this week' }));
    expect(await within(friday).findByText('Curry night')).toBeVisible();
    await waitFor(() => expect(within(friday).queryByText('Pizza')).toBeNull());
    // The next Friday still has the recurring pizza.
    await user.click(screen.getByRole('button', { name: 'Next 7 days' }));
    const next = await screen.findByRole('listitem', { name: new RegExp(`^Friday`) }, {});
    expect(await within(next).findByText('Pizza')).toBeVisible();
  });

  it('edits the rule from the occurrence sheet', async () => {
    const { user } = await openPlan();
    const friday = await dayCard(FRIDAY());
    await user.click(await within(friday).findByRole('button', { name: /^Pizza/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Edit recurring meal',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Edit recurring meal' })).toBeVisible();
    const what = within(dialog).getByLabelText('What');
    await user.clear(what);
    await user.type(what, 'Homemade pizza');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(friday).findByText('Homemade pizza')).toBeVisible();
  });

  it('makes a normal entry recurring, prefilled from it', async () => {
    const { user } = await openPlan();
    await user.click(await screen.findByRole('button', { name: /^Eat out.*Actions/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Make this recurring',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('What')).toHaveValue('Eat out');
    expect(within(dialog).getByRole('radio', { name: 'Dinner' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const eatOutDay = addDays(storeToday(), 4);
    expect(within(dialog).getByLabelText('Starts')).toHaveValue(eatOutDay);
    expect(within(dialog).getByRole('radio', { name: dayName(eatOutDay) })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Every 2 weeks' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring meal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('link', { name: 'Recurring meals' }));
    const row = await screen.findByRole('button', { name: /^Eat out/ });
    expect(within(row).getByText(/^Every 2nd \w+ · Dinner \(next /)).toBeVisible();
  });
});

describe('Recurring meals screen', () => {
  async function openScreen() {
    const app = await openPlan();
    await app.user.click(screen.getByRole('link', { name: 'Recurring meals' }));
    await screen.findByRole('heading', { name: 'Recurring meals', level: 1 });
    return app;
  }

  it('lists rules by weekday with a summary and hides the tab bar', async () => {
    await openScreen();
    expect(await screen.findByText('Every Friday · Dinner', {}, { timeout: 3000 })).toBeVisible();
    const thursdays = screen.getByRole('region', { name: 'Thursday' });
    expect(within(thursdays).getByText('Chicken wraps')).toBeVisible();
    expect(
      within(thursdays).getByText(/^Every 2nd Thursday · Dinner \(next \d+ \w+\)$/),
    ).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Recipes' })).toBeVisible();
  });

  it('adds a rule with a recipe, frequency and end date', async () => {
    const { user } = await openScreen();
    await user.click(await screen.findByRole('button', { name: 'Add recurring meal' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('radio', { name: /Greek salad/ }, {}));
    await user.click(within(dialog).getByRole('radio', { name: 'Lunch' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Sunday' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Every 3 weeks' }));
    // The start date moved to a Sunday, and picking a start date moves the weekday back.
    const start = within(dialog).getByLabelText('Starts') as HTMLInputElement;
    expect(new Date(`${start.value}T00:00:00Z`).getUTCDay()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring meal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sunday = screen.getByRole('region', { name: 'Sunday' });
    expect(within(sunday).getByText('Greek salad')).toBeVisible();
    expect(within(sunday).getByText(/^Every 3rd Sunday · Lunch \(next /)).toBeVisible();
  });

  it('validates before saving', async () => {
    const { user } = await openScreen();
    await user.click(await screen.findByRole('button', { name: 'Add recurring meal' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring meal' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose a recipe.');
    await user.click(within(dialog).getByRole('button', { name: 'Something else' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring meal' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter some text.');
  });

  it('pauses a rule and then deletes it after confirming', async () => {
    const { user } = await openScreen();
    await user.click(await screen.findByRole('button', { name: /^Pizza/ }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: /Paused/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Every Friday · Dinner (paused)')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /^Pizza/ }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryByText(/^Pizza/)).toBeNull());
  });
});
