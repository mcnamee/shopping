// @vitest-environment jsdom
import type { ListItem } from '@trolley/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopRow } from './ShopRow';

const NOTE =
  'Get the lactose free one in the green carton, not the blue, and check the date is at least a week away';

const item = (over: Partial<ListItem> = {}): ListItem =>
  ({
    id: 'p~each',
    qty: 1,
    unit: 'each',
    ticked: false,
    tickedAt: null,
    note: NOTE,
    version: 1,
    product: { productId: 'p', name: 'Milk', packSize: null, imageUrl: null, groupId: 'dairy' },
    ...over,
  }) as unknown as ListItem;

describe('ShopRow', () => {
  it('shows a long note in full and wraps it (B-012)', () => {
    render(
      <ul>
        <ShopRow item={item()} />
      </ul>,
    );
    const note = screen.getByText(NOTE);
    expect(note).toBeVisible();
    expect(note.className).not.toMatch(/truncate|line-clamp/);
    expect(note.className).toMatch(/whitespace-normal/);
  });

  it('marks a tick that is waiting to sync', () => {
    const { rerender } = render(
      <ul>
        <ShopRow item={item({ note: null })} />
      </ul>,
    );
    expect(screen.queryByTestId('pending-sync')).toBeNull();
    rerender(
      <ul>
        <ShopRow item={item({ note: null })} pending />
      </ul>,
    );
    expect(screen.getByTestId('pending-sync')).toHaveTextContent('Waiting to sync');
  });
});
