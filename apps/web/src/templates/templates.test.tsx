// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ListsResponse, TemplatesResponse } from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { callMock, failNext, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const log = () => (globalThis as { __mockApiLog?: string[] }).__mockApiLog ?? [];
beforeEach(() => {
  (globalThis as { __mockApiLog?: string[] }).__mockApiLog = [];
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

async function templates(path = '/templates') {
  const app = await renderMockApp(path);
  await screen.findByRole('link', { name: /Weekly basics/ }, { timeout: 3000 });
  return app;
}

async function editor(id = MOCK_SEED_IDS.mealTemplate) {
  const app = await renderMockApp(`/templates/${id}`);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  await screen.findByRole('group', { name: /^Items in / });
  return app;
}

describe('Templates tab', () => {
  it('lists weekly first, then by name, with type badges, counts and a preview', async () => {
    await templates();
    const cards = screen.getAllByRole('link', { name: /template,\s*\d+ items?$/ });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAccessibleName(/^Weekly basics\s*Weekly\s*weekly template,\s*10 items$/);
    expect(cards[1]).toHaveAccessibleName(/^Tacos\s*Meal\s*meal template,\s*5 items$/);
    expect(within(cards[0] as HTMLElement).getByText('Weekly')).toBeVisible();
    expect(within(cards[1] as HTMLElement).getByText('Meal')).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText(/\+7$/)).toBeVisible();
    expect(cards[0]).toHaveAttribute('href', `/templates/${MOCK_SEED_IDS.weeklyTemplate}`);
  });

  it('filters by type from the chips and offers New template when a type is empty', async () => {
    const { user } = await templates();
    await user.click(screen.getByRole('radio', { name: 'Meal' }));
    expect(screen.getByRole('radio', { name: 'Meal' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('link', { name: /Weekly basics/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Tacos/ })).toBeVisible();
    // The other phone deletes the only meal template; coming back to the app refetches.
    await callMock('DELETE', `/templates/${MOCK_SEED_IDS.mealTemplate}`);
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('No meal templates yet')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(0);
  });

  it('shows the empty state with a New template button', async () => {
    await templates();
    for (const t of (await callMock<TemplatesResponse>('GET', '/templates')).body.templates) {
      await callMock('DELETE', `/templates/${t.id}`);
    }
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('heading', { name: 'No templates yet' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(0);
  });

  it('shows an error with Try again', async () => {
    await renderMockApp('/templates', { fail: { match: 'GET /api/templates', times: 2 } });
    expect(
      await screen.findByText("Couldn't load your templates", {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

describe('create and edit a template', () => {
  it('creates a template, saves it and lands on its page', async () => {
    const { user } = await renderMockApp('/templates/new');
    expect(await screen.findByRole('heading', { level: 1, name: 'New template' })).toBeVisible();
    expect(screen.getByText(/For items you buy most weeks/)).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Meal' }));
    expect(screen.getByText(/For a specific meal, like tacos/)).toBeVisible();
    await user.type(screen.getByLabelText('Name'), 'Roast night');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved Roast night')).toBeVisible();
    expect(await screen.findByRole('heading', { level: 1, name: 'Roast night' })).toBeVisible();
    expect(await screen.findByText('No items yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add to a list' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeVisible();
    const created = (await callMock<TemplatesResponse>('GET', '/templates')).body.templates.find(
      (t) => t.name === 'Roast night',
    );
    expect(created?.type).toBe('meal');
  });

  it('validates the name on Save', async () => {
    const { user } = await renderMockApp('/templates/new');
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    const field = screen.getByLabelText('Name');
    expect(screen.getByText('Enter a name for this template.')).toBeVisible();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    await user.type(field, 'x'.repeat(61));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Keep it to 60 characters or fewer.')).toBeVisible();
  });

  it('Save is disabled until something changes, then renames and changes the type', async () => {
    const { user } = await editor();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Burrito night');
    await user.click(screen.getByRole('radio', { name: 'Weekly' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved Burrito night')).toBeVisible();
    expect(await screen.findByRole('heading', { level: 1, name: 'Burrito night' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true'),
    );
    const t = (await callMock<TemplatesResponse>('GET', '/templates')).body.templates.find(
      (x) => x.id === MOCK_SEED_IDS.mealTemplate,
    );
    expect(t).toMatchObject({ name: 'Burrito night', type: 'weekly' });
  });

  it('asks before discarding unsaved changes', async () => {
    const { user } = await editor();
    await user.type(screen.getByLabelText('Name'), ' x');
    await user.click(screen.getByRole('link', { name: 'Back to templates' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(within(confirm).getByText("You've changed this template's name or type.")).toBeVisible();
    expect(within(confirm).getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Tacos x');
    await user.click(screen.getByRole('link', { name: 'Back to templates' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }),
    );
    expect(await screen.findByRole('link', { name: /Weekly basics/ })).toBeVisible();
  });

  it('Save and continue saves then leaves; a failed save stays with the error', async () => {
    const { user } = await editor();
    await user.type(screen.getByLabelText('Name'), ' x');
    failNext('PATCH /api/templates/', 500);
    await user.click(screen.getByRole('link', { name: 'Back to templates' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Save and continue',
      }),
    );
    expect(await screen.findByText(/Couldn't save that template/)).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to templates' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Save and continue',
      }),
    );
    expect(await screen.findByRole('link', { name: /Tacos x/ })).toBeVisible();
  });

  it('does not prompt when nothing has changed, and guards beforeunload only while dirty', async () => {
    const { user } = await editor();
    const ev = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(ev()).toBe(false);
    await user.type(screen.getByLabelText('Name'), ' x');
    expect(ev()).toBe(true);
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Tacos');
    expect(ev()).toBe(false);
    await user.click(screen.getByRole('link', { name: 'Back to templates' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Weekly basics/ })).toBeVisible();
  });

  it('a stale rename (409) shows "Changed on another phone." with Show latest', async () => {
    const { user } = await editor();
    await user.type(screen.getByLabelText('Name'), ' x');
    failNext('PATCH /api/templates/', 409);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const banner = await screen.findByText('Changed on another phone.');
    expect(banner).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show latest' }));
    await waitFor(() => expect(screen.queryByText('Changed on another phone.')).toBeNull());
    expect(screen.getByLabelText('Name')).toHaveValue('Tacos');
  });

  it('a failed save shows the banner and keeps the edits', async () => {
    const { user } = await editor();
    await user.type(screen.getByLabelText('Name'), ' x');
    failNext('PATCH /api/templates/', 500);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save that template. Please try again.",
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Tacos x');
  });
});

describe('template items', () => {
  it('lists items in aisle order with quantity, pack size and note', async () => {
    await editor();
    const list = screen.getByRole('group', { name: 'Items in Tacos' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(screen.getByText('Items (5)')).toBeVisible();
    expect(within(list).getByRole('button', { name: /Edit Gourmet Tomatoes/ })).toHaveTextContent(
      'For salsa',
    );
    expect(within(list).getByRole('button', { name: /Edit Gourmet Tomatoes/ })).toHaveTextContent(
      '0.5 kg',
    );
  });

  it('removes an item with Undo that puts it back with its quantity and note', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: /Remove Gourmet Tomatoes/ }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Edit Gourmet Tomatoes/ })).toBeNull(),
    );
    expect(screen.getByText('Items (4)')).toBeVisible();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: /Edit Gourmet Tomatoes/ })).toHaveTextContent(
      'For salsa',
    );
    expect(screen.getByText('Items (5)')).toBeVisible();
  });

  it('rolls back a failed removal with the save-failed toast', async () => {
    const { user } = await editor();
    failNext('DELETE /api/templates/', 500);
    await user.click(screen.getByRole('button', { name: /Remove Gourmet Tomatoes/ }));
    expect(await screen.findByText("Couldn't save. Check your connection.")).toBeVisible();
    expect(await screen.findByRole('button', { name: /Edit Gourmet Tomatoes/ })).toBeVisible();
  });

  it('edits quantity, unit and note in the quantity modal (edit mode, no target, no remove)', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: /Edit Gourmet Tomatoes/ }));
    const dialog = await screen.findByRole('dialog', { name: /Gourmet Tomatoes/ });
    expect(within(dialog).queryByRole('button', { name: /^Adding to/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Remove from list' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Edit Gourmet Tomatoes/ })).toHaveTextContent('2 kg');
  });

  it('a stale item edit closes the sheet with the latest-showing toast', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: /Edit Gourmet Tomatoes/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '2 kg' }));
    failNext('PATCH /api/templates/', 409);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changed on another phone - showing latest')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Add items goes to Search with the template as context', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: 'Add items' }));
    const bar = await screen.findByTestId('search-context');
    await waitFor(() => expect(bar).toHaveTextContent('Adding to template Tacos'));
  });

  it('Add to a list merges into the chosen list and reports the count with Undo', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: 'Add to a list' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to a list' });
    const radios = await within(sheet).findAllByRole('radio');
    expect(radios[0]).toHaveTextContent('This week');
    await user.click(within(sheet).getByRole('button', { name: /^Add to Week of/ }));
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent(/^Added 5 items to Week of .*\(\d combined\)Undo$/);
    const before = (await callMock<ListsResponse>('GET', '/lists')).body.lists[0];
    expect(before?.itemCount).toBeGreaterThan(21);
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await callMock<ListsResponse>('GET', '/lists')).body.lists[0]?.itemCount).toBe(21),
    );
  });

  it('Add to a list > New list opens the sheet with this template ticked', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: 'Add to a list' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to a list' });
    await user.click(await within(sheet).findByRole('button', { name: 'New list' }));
    const newList = await screen.findByRole('dialog', { name: 'New list' });
    expect(await within(newList).findByRole('checkbox', { name: /Tacos/ })).toBeChecked();
    expect(within(newList).getByRole('radio', { name: 'From templates' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('Delete template confirms, deletes and goes back to the list', async () => {
    const { user } = await editor();
    await user.click(screen.getByRole('button', { name: 'Delete template' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Tacos?' });
    expect(confirm).toHaveTextContent("Lists you've already made from it won't change.");
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Delete template' }));
    expect(await screen.findByText('Deleted Tacos')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('link', { name: /Tacos/ })).toBeNull());
    expect(log().some((c) => c.startsWith('DELETE /api/templates/'))).toBe(true);
  });

  it('shows "That template isn\'t here any more." for a missing template', async () => {
    await renderMockApp('/templates/00000000-0000-4000-8000-00000000ffff');
    expect(await screen.findByText("That template isn't here any more.")).toBeVisible();
  });
});
