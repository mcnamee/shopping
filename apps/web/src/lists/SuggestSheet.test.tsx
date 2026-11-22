// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  COLD_START_NOTE,
  type BulkAddItemsResponse,
  type SuggestionsResponse,
} from '@trolley/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SEED_IDS } from '../api/mock-stage2';
import { callMock, failNext, renderMockApp } from '../test/mockApp';

vi.mock('../auth/service', async () => (await import('../test/authService')).serviceMock);

const LIST_ID = MOCK_SEED_IDS.thisWeekList;
const g = globalThis as {
  __mockSuggest?: unknown;
  __mockApiDelay?: unknown;
  __mockApiFail?: unknown;
};

interface Spy {
  signal: AbortSignal | undefined;
  bulkBody: { items: { productId: string; qty: number; unit: string }[] } | null;
  bulkResponse: BulkAddItemsResponse | null;
}

/** Wraps the mock fetch to observe the suggestions signal and bulk traffic, and optionally rewrite. */
interface SpyOpts {
  suggestions?: SuggestionsResponse;
  dropLastFromBulk?: boolean;
  delayMs?: number;
  fail?: boolean;
}

function installSpy(opts: SpyOpts, spy: Spy) {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/suggestions')) {
      spy.signal = init?.signal ?? undefined;
      if (opts.suggestions) {
        return new Response(JSON.stringify(opts.suggestions), { status: 200 });
      }
    }
    if (String(url).endsWith('/items/bulk') && init?.body) {
      const body = JSON.parse(String(init.body)) as NonNullable<Spy['bulkBody']>;
      spy.bulkBody = structuredClone(body);
      const dropped = opts.dropLastFromBulk ? body.items.pop() : undefined;
      const res = await real(url, { ...init, body: JSON.stringify(body) });
      const json = (await res.json()) as BulkAddItemsResponse;
      if (dropped) {
        json.results.push({
          ok: false,
          productId: dropped.productId,
          unit: dropped.unit as 'each',
          code: 'VALIDATION',
          message: 'Nope',
        });
        json.failed += 1;
      }
      spy.bulkResponse = structuredClone(json);
      return new Response(JSON.stringify(json), { status: res.status });
    }
    return real(url, init);
  });
}

beforeEach(() => {
  g.__mockSuggest = null;
  g.__mockApiDelay = null;
});
afterEach(() => {
  cleanup();
  g.__mockSuggest = null;
  g.__mockApiDelay = null;
  g.__mockApiFail = null;
  vi.unstubAllGlobals();
});

/** Opens the sheet from a new empty list (empty-state button) or from this week's list (options row). */
async function openSheet(opts: SpyOpts & { list?: 'empty' | 'week' } = {}) {
  let path = `/lists/${LIST_ID}`;
  const { list = 'empty', delayMs, fail, ...spyOpts } = opts;
  const spy: Spy = { signal: undefined, bulkBody: null, bulkResponse: null };
  const app = await renderMockApp(path);
  await screen.findByRole('heading', { level: 1, name: /Week of/ }, { timeout: 3000 });
  if (list === 'empty') {
    const made = await callMock<{ list: { id: string; name: string } }>('POST', '/lists', {
      name: 'Empty one',
      thisWeek: false,
    });
    path = `/lists/${made.body.list.id}`;
    fireEvent.click(screen.getByRole('link', { name: 'Back to lists' }));
    await app.user.click(await screen.findByRole('link', { name: /Empty one/ }));
    await screen.findByRole('heading', { level: 1, name: 'Empty one' });
  }
  installSpy(spyOpts, spy);
  if (delayMs) g.__mockApiDelay = { match: 'POST /api/lists/', ms: delayMs };
  if (fail) failNext('POST /api/lists/', 500);
  if (list === 'empty') {
    await app.user.click(await screen.findByRole('button', { name: 'Suggest items' }));
  } else {
    await app.user.click(screen.getByRole('button', { name: 'List options' }));
    await app.user.click(await screen.findByRole('button', { name: 'Suggest items' }));
  }
  return { ...app, spy };
}
const sheet = () => screen.findByRole('dialog', { name: 'Suggested items' });
const addButton = (s: HTMLElement) =>
  within(s).getByRole('button', { name: /^Add( \d+ items?|\s+items)?$/ });
const toast = () => screen.findByTestId('toast');

describe('Suggest items sheet', () => {
  it('shows loading copy and Cancel aborts the request and adds nothing', async () => {
    const { user, spy } = await openSheet({ delayMs: 3000 });
    const s = await sheet();
    expect(within(s).getByText('Looking at what you usually buy...')).toBeVisible();
    await waitFor(() => expect(spy.signal).toBeDefined());
    await user.click(within(s).getByRole('button', { name: 'Cancel' }));
    expect(spy.signal?.aborted).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Suggested items' })).toBeNull(),
    );
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(spy.bulkBody).toBeNull();
  });

  it('groups by aisle, pre-ticks, shows the server reason as sent, and Weekly badges', async () => {
    await openSheet();
    const s = await sheet();
    const boxes = await within(s).findAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(within(s).getAllByRole('group', { name: /./ }).length).toBeGreaterThan(0);
    const first = boxes[0] as HTMLElement;
    const why = document.getElementById(first.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent?.trim()).toBeTruthy();
    expect(within(s).getAllByText('Weekly').length).toBeGreaterThan(0);
    expect(within(s).getByText(`${boxes.length} of ${boxes.length} selected`)).toBeVisible();
    expect(addButton(s)).toHaveTextContent(`Add ${boxes.length} item`);
  });

  it('toggles rows, select none/all, and the primary label follows the count', async () => {
    const { user } = await openSheet();
    const s = await sheet();
    const boxes = await within(s).findAllByRole('checkbox');
    const n = boxes.length;
    await user.click(boxes[0] as HTMLElement);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'false');
    expect(addButton(s)).toHaveTextContent(n - 1 === 1 ? 'Add 1 item' : `Add ${n - 1} items`);
    await user.click(within(s).getByRole('button', { name: 'Select all' }));
    await user.click(within(s).getByRole('button', { name: 'Select none' }));
    expect(addButton(s)).toHaveAttribute('aria-disabled', 'true');
    expect(addButton(s)).toHaveTextContent('Add items');
    await user.click(addButton(s));
    expect(screen.queryByTestId('toast')).toBeNull();
    await user.click(within(s).getByRole('button', { name: 'Select all' }));
    expect(addButton(s)).toHaveTextContent(`Add ${n} item`);
  });

  it('edits quantity with the stepper and sends it, clamping typed values', async () => {
    const { user, spy } = await openSheet();
    const s = await sheet();
    const plus = (
      await within(s).findAllByRole('button', { name: /^Increase quantity for / })
    )[0] as HTMLElement;
    const name = plus.getAttribute('aria-label')?.replace('Increase quantity for ', '') ?? '';
    const input = within(s).getByRole('textbox', {
      name: `Quantity of ${name}`,
    }) as HTMLInputElement;
    const before = Number(input.value);
    await user.click(plus);
    expect(Number(input.value)).toBeGreaterThan(before);
    const after = Number(input.value);
    // Typed out of range: clamps to the maximum.
    const other = within(s).getAllByRole('textbox')[1] as HTMLInputElement;
    fireEvent.change(other, { target: { value: '9999999' } });
    fireEvent.blur(other);
    expect(Number(other.value)).toBeLessThanOrEqual(20000);
    expect(within(s).getByRole('status')).toHaveTextContent(/Quantity set to .*, the maximum/);
    // Unticked rows lock their stepper.
    const row = within(s).getAllByRole('checkbox').at(-1) as HTMLElement;
    await user.click(row);
    await user.click(addButton(s));
    await waitFor(() => expect(spy.bulkBody).not.toBeNull());
    expect(spy.bulkBody?.items.some((i) => i.qty === after)).toBe(true);
    expect(spy.bulkBody?.items.length).toBe(within(s).getAllByRole('checkbox').length - 1);
  });

  it('adds the ticked items, reports the count and Undo removes them', async () => {
    const { user, spy } = await openSheet();
    const s = await sheet();
    await within(s).findAllByRole('checkbox');
    await user.click(addButton(s));
    const n = spy.bulkBody?.items.length ?? 0;
    await waitFor(() => expect(spy.bulkResponse).not.toBeNull());
    expect(await toast()).toHaveTextContent(new RegExp(`^Added ${n} items?`));
    expect(screen.queryByRole('dialog', { name: 'Suggested items' })).toBeNull();
    await user.click(within(await toast()).getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Removed \d+ items?/),
    );
  });

  it('reports a partial add as "Added X of Y"', async () => {
    const { user, spy } = await openSheet({ dropLastFromBulk: true });
    const s = await sheet();
    await within(s).findAllByRole('checkbox');
    await user.click(addButton(s));
    await waitFor(() => expect(spy.bulkResponse).not.toBeNull());
    const total = spy.bulkResponse?.results.length ?? 0;
    expect(await toast()).toHaveTextContent(
      `Added ${total - 1} of ${total} - 1 couldn't be added. Add them from Search`,
    );
  });

  it('keeps rows that changed on another phone when undoing', async () => {
    const { user, spy } = await openSheet();
    const s = await sheet();
    await within(s).findAllByRole('checkbox');
    await user.click(addButton(s));
    await waitFor(() => expect(spy.bulkResponse).not.toBeNull());
    const created = spy.bulkResponse?.results.find((r) => r.ok && r.change.created);
    if (!created?.ok) throw new Error('expected a created row');
    const patched = await callMock(
      'PATCH',
      `/lists/${spy.bulkResponse?.list.id}/items/${created.change.itemId}`,
      {
        qty: 3,
        version: created.change.version,
      },
    );
    expect(patched.status).toBe(200);
    await user.click(within(await toast()).getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(
        'Some items changed on another phone and were kept',
      ),
    );
  });

  it('shows the server note on cold start and still lets you add the template items', async () => {
    g.__mockSuggest = { mode: 'coldStart' };
    await openSheet();
    const s = await sheet();
    expect(await within(s).findByText(COLD_START_NOTE)).toBeVisible();
    expect((await within(s).findAllByRole('checkbox')).length).toBeGreaterThan(0);
  });

  it('shows "Nothing to suggest yet" with no history and no template', async () => {
    g.__mockSuggest = { mode: 'empty' };
    await openSheet();
    const s = await sheet();
    expect(await within(s).findByRole('heading', { name: 'Nothing to suggest yet' })).toBeVisible();
    expect(within(s).getByRole('button', { name: 'Go to Templates' })).toBeVisible();
    expect(within(s).queryByRole('button', { name: /^Add/ })).toBeNull();
  });

  it('shows "You\'re all set" when history has nothing due', async () => {
    await openSheet({
      suggestions: { source: 'ai', coldStart: false, note: null, suggestions: [] },
    });
    const s = await sheet();
    expect(await within(s).findByRole('heading', { name: "You're all set" })).toBeVisible();
    expect(within(s).getByText('Nothing else looks due this week.')).toBeVisible();
    expect(within(s).getByRole('button', { name: 'Done' })).toBeVisible();
  });

  it('shows the 429 message inline, not as an error page', async () => {
    g.__mockSuggest = { mode: 'limit' };
    await openSheet();
    const s = await sheet();
    expect(await within(s).findByRole('alert')).toHaveTextContent(
      "You've used today's suggestions - try again tomorrow.",
    );
    expect(within(s).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers Try again when the server is unreachable', async () => {
    const { user } = await openSheet({ fail: true });
    const s = await sheet();
    expect(await within(s).findByRole('alert')).toHaveTextContent(
      "Couldn't get suggestions right now.",
    );
    await user.click(within(s).getByRole('button', { name: 'Try again' }));
    expect((await within(s).findAllByRole('checkbox')).length).toBeGreaterThan(0);
  });
});
